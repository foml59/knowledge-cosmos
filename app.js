// 3D知识星系可视化

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class EventBus {
    constructor() {
        this.events = {};
    }
    on(event, callback) {
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push(callback);
        return () => this.off(event, callback);
    }
    off(event, callback) {
        if (!this.events[event]) return;
        const idx = this.events[event].indexOf(callback);
        if (idx !== -1) this.events[event].splice(idx, 1);
    }
    emit(event, data) {
        if (!this.events[event]) return;
        this.events[event].forEach(cb => {
            try { cb(data); } catch (e) { console.error(e); }
        });
    }
}

class PhysicsEngine {
    static G = 1.0;

    // v = sqrt(GM/r)
    static orbitalVelocity(centralMass, radius) {
        if (radius <= 0) return 0;
        return Math.sqrt(this.G * centralMass / radius);
    }

    // T = 2π * sqrt(r³/GM)
    static orbitalPeriod(centralMass, radius) {
        if (radius <= 0) return Infinity;
        return 2 * Math.PI * Math.sqrt(Math.pow(radius, 3) / (this.G * centralMass));
    }

    // ω = sqrt(GM/r³)
    static orbitalAngularVelocity(centralMass, radius) {
        if (radius <= 0) return 0;
        return Math.sqrt(this.G * centralMass / Math.pow(radius, 3));
    }

    static calculateEllipticalPosition(radius, angle, eccentricity = 0, inclination = 0) {
        // r = a(1-e²)/(1+e*cos(θ))
        const a = radius;
        const e = Math.min(eccentricity, 0.99);
        const r = a * (1 - e * e) / (1 + e * Math.cos(angle));

        const x = r * Math.cos(angle);
        const z = r * Math.sin(angle);
        const y = r * Math.sin(inclination) * Math.sin(angle);

        return new THREE.Vector3(x, y, z);
    }

    static calculateMass(importance, type) {
        const baseMass = {
            'blackhole': 1000,
            'galaxy-core': 150,
            'satellite': 30,
            'asteroid': 8,
            'comet': 15
        };
        const base = baseMass[type] || 10;
        return base * (importance / 5);
    }

    static calculateOrbitRadius(type, level, index, total) {
        const baseRadius = {
            'blackhole': 0,
            'galaxy-core': 220,
            'satellite': 70,
            'asteroid': 28,
            'comet': 380
        };

        if (type === 'blackhole') return 0;

        const base = baseRadius[type] || 20;
        const spreadFactor = type === 'galaxy-core' ? 0.6 :
                             type === 'satellite' ? 0.5 :
                             type === 'asteroid' ? 1.2 : 0.4;
        const spread = base * spreadFactor;
        const offset = total > 1 ? (index / (total - 1) - 0.5) * spread : 0;
        return base + offset;
    }

    update(bodies, deltaTime, timeScale) {
        const dt = deltaTime * timeScale;

        bodies.forEach((body, id) => {
            if (!body.orbitParams) return;

            const params = body.orbitParams;

            params.orbitAngle += params.orbitSpeed * dt;

            const localPos = PhysicsEngine.calculateEllipticalPosition(
                params.orbitRadius,
                params.orbitAngle,
                params.orbitEccentricity,
                params.orbitInclination
            );

            let parentPos = new THREE.Vector3(0, 0, 0);
            if (params.parentId && bodies.has(params.parentId)) {
                const parent = bodies.get(params.parentId);
                parentPos = parent.mesh.position.clone();
            }

            const newPos = parentPos.add(localPos);
            body.mesh.position.copy(newPos);

            if (body.label) {
                body.label.position.copy(newPos).add(new THREE.Vector3(0, body.visualRadius + 2, 0));
            }
        });

        this.resolveCollisions(bodies);
    }

    // 防止天体重叠的简单排斥
    resolveCollisions(bodies) {
        const bodyArray = Array.from(bodies.values());
        const minGap = 3;

        for (let i = 0; i < bodyArray.length; i++) {
            for (let j = i + 1; j < bodyArray.length; j++) {
                const a = bodyArray[i];
                const b = bodyArray[j];
                if (!a.orbitParams || !b.orbitParams) continue;
                if (a.data.type === 'blackhole' || b.data.type === 'blackhole') continue;

                const dx = a.mesh.position.x - b.mesh.position.x;
                const dy = a.mesh.position.y - b.mesh.position.y;
                const dz = a.mesh.position.z - b.mesh.position.z;
                const distSq = dx * dx + dy * dy + dz * dz;
                const dist = Math.sqrt(distSq);

                const rA = this.getVisualRadius(a.data.type, a.data.importance);
                const rB = this.getVisualRadius(b.data.type, b.data.importance);
                const safeDist = rA + rB + minGap;

                if (dist < safeDist && dist > 0.01) {
                    const overlap = safeDist - dist;
                    const totalMass = a.data.mass + b.data.mass;
                    const ratioA = b.data.mass / totalMass;
                    const ratioB = a.data.mass / totalMass;

                    const nx = dx / dist;
                    const ny = dy / dist;
                    const nz = dz / dist;

                    const pushFactor = overlap * 0.5;

                    a.mesh.position.x += nx * pushFactor * ratioA;
                    a.mesh.position.y += ny * pushFactor * ratioA;
                    a.mesh.position.z += nz * pushFactor * ratioA;

                    b.mesh.position.x -= nx * pushFactor * ratioB;
                    b.mesh.position.y -= ny * pushFactor * ratioB;
                    b.mesh.position.z -= nz * pushFactor * ratioB;

                    if (a.label) {
                        a.label.position.copy(a.mesh.position).add(new THREE.Vector3(0, a.visualRadius + 2, 0));
                    }
                    if (b.label) {
                        b.label.position.copy(b.mesh.position).add(new THREE.Vector3(0, b.visualRadius + 2, 0));
                    }
                }
            }
        }
    }

    getVisualRadius(type, importance) {
        const base = { 'galaxy-core': 5, satellite: 3, asteroid: 1.5, comet: 2.5 };
        return (base[type] || 2) * (0.8 + (importance || 5) / 10);
    }
}

class GalaxyRenderer {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.clock = new THREE.Clock();
        this.updateCallbacks = [];
        this.isRunning = false;
        this.animationId = null;
    }

    async init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        this.scene.fog = new THREE.FogExp2(0x000000, 0.0003);

        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100000);
        this.camera.position.set(0, 150, 300);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 10;
        this.controls.maxDistance = 50000;
        this.controls.autoRotate = false;
        this.controls.zoomSpeed = 0.8;
        this.controls.rotateSpeed = 0.6;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        const centerLight = new THREE.PointLight(0xff4400, 3, 800);
        centerLight.position.set(0, 0, 0);
        this.scene.add(centerLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.3);
        dirLight.position.set(100, 200, 100);
        this.scene.add(dirLight);

        this._onResize = this.onResize.bind(this);
        window.addEventListener('resize', this._onResize);
    }

    addUpdateCallback(callback) {
        this.updateCallbacks.push(callback);
    }

    removeUpdateCallback(callback) {
        const idx = this.updateCallbacks.indexOf(callback);
        if (idx !== -1) this.updateCallbacks.splice(idx, 1);
    }

    start() {
        this.isRunning = true;
        this.clock.start();

        this.renderer.render(this.scene, this.camera);

        this.tick();
    }

    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    tick() {
        if (!this.isRunning) return;
        this.animationId = requestAnimationFrame(() => this.tick());

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();

        this.controls.update();

        this.updateCallbacks.forEach(cb => {
            try { cb(delta, elapsed); } catch (e) { console.error(e); }
        });

        try {
            this.renderer.render(this.scene, this.camera);
        } catch (e) {
            if (!e.message.includes('refreshUniformsCommon')) {
                console.error(e);
            }
        }
    }

    onResize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    dispose() {
        this.stop();
        window.removeEventListener('resize', this._onResize);
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
    }
}

class GalaxyScene {
    constructor(renderer) {
        this.renderer = renderer;
        this.scene = renderer.scene;
        this.data = null;
        this.bodies = new Map();
        this.physics = new PhysicsEngine();
        this.timeScale = 1.0;
        this.isPaused = false;
        this.starfield = null;
        this.orbitLines = [];
        this.blackHole = null;
        this.accretionDisk = null;
    }

    async loadData() {
        try {
            const response = await fetch(`data/computer-network-galaxy.json?t=${Date.now()}`);
            this.data = await response.json();
        } catch (e) {
            console.error('[GalaxyScene] 数据加载失败:', e);
            this.data = { nodes: [], links: [] };
        }
        return this.data;
    }

    build() {
        if (!this.data || !this.data.nodes) return;

        this.createStarfield();
        this.buildHierarchy();
        this.createBodies();
        this.createOrbitLines();
        this.createBlackHole();
    }

    buildHierarchy() {
        const nodes = this.data.nodes;
        const typeOrder = ['blackhole', 'galaxy-core', 'satellite', 'asteroid', 'comet'];

        const satelliteChildCount = {};

        nodes.forEach(node => {
            node.mass = PhysicsEngine.calculateMass(node.importance || 5, node.type);
            let parentId = null;

            if (node.type === 'blackhole') {
                parentId = null;
            } else if (node.type === 'comet') {
                const blackhole = nodes.find(n => n.type === 'blackhole');
                parentId = blackhole ? blackhole.id : null;
            } else if (node.type === 'galaxy-core') {
                const blackhole = nodes.find(n => n.type === 'blackhole');
                parentId = blackhole ? blackhole.id : null;
            } else if (node.type === 'satellite') {
                const galaxyCores = nodes.filter(n => n.field === node.field && n.type === 'galaxy-core');
                parentId = galaxyCores.length > 0 ? galaxyCores[0].id : null;
                if (!parentId) {
                    const blackhole = nodes.find(n => n.type === 'blackhole');
                    parentId = blackhole ? blackhole.id : null;
                }
            } else if (node.type === 'asteroid') {
                const satellites = nodes.filter(n => n.field === node.field && n.type === 'satellite');

                if (satellites.length > 0) {
                    satellites.forEach(s => {
                        if (!satelliteChildCount[s.id]) satelliteChildCount[s.id] = 0;
                    });

                    const nodeName = node.name.toLowerCase();
                    let bestMatch = null;
                    let bestScore = -1;

                    satellites.forEach(sat => {
                        const satName = sat.name.toLowerCase();
                        let score = 0;
                        if (nodeName.includes(satName) || satName.includes(nodeName)) score += 10;
                        const keywords = ['历史', '分类', '性能', '结构', '协议', '地址', '路由', '设备', '安全', '应用', 'dns', 'http', 'tcp', 'udp', 'ip', 'osi', '加密', '攻击', '威胁', '层', '物理', '数据链路', '网络层', '传输', '会话', '表示'];
                        keywords.forEach(kw => {
                            if (nodeName.includes(kw) && satName.includes(kw)) score += 5;
                        });
                        score += (10 - (satelliteChildCount[sat.id] || 0)) * 2;
                        if (score > bestScore) { bestScore = score; bestMatch = sat; }
                    });

                    if (bestMatch) {
                        parentId = bestMatch.id;
                        satelliteChildCount[parentId] = (satelliteChildCount[parentId] || 0) + 1;
                    }
                }

                if (!parentId) {
                    const galaxyCores = nodes.filter(n => n.field === node.field && n.type === 'galaxy-core');
                    if (galaxyCores.length > 0) parentId = galaxyCores[0].id;
                }
                if (!parentId) {
                    const blackhole = nodes.find(n => n.type === 'blackhole');
                    parentId = blackhole ? blackhole.id : null;
                }
            }

            node._parentId = parentId;
        });

        const parentChildCount = {};
        const parentChildIndex = {};

        nodes.forEach(node => {
            if (!node._parentId) return;
            if (!parentChildCount[node._parentId]) parentChildCount[node._parentId] = 0;
            parentChildCount[node._parentId]++;
        });

        nodes.forEach(node => {
            if (!node._parentId) return;
            const pid = node._parentId;
            if (!parentChildIndex[pid]) parentChildIndex[pid] = 0;
            node._siblingIndex = parentChildIndex[pid];
            parentChildIndex[pid]++;
        });

        nodes.forEach(node => {
            if (node.type === 'blackhole') {
                node.orbitParams = { parentId: null, orbitRadius: 0, orbitInclination: 0, orbitEccentricity: 0, orbitAngle: 0, orbitSpeed: 0, level: 0 };
                return;
            }

            const parentId = node._parentId;
            const siblingCount = parentChildCount[parentId] || 1;
            const siblingIndex = node._siblingIndex || 0;
            const level = typeOrder.indexOf(node.type);

            const baseRadius = {
                'galaxy-core': 220,
                'satellite': 70,
                'asteroid': 28,
                'comet': 380
            };

            let orbitRadius;
            if (node.type === 'galaxy-core' || node.type === 'comet') {
                const sameTypeNodes = nodes.filter(n => n.type === node.type);
                const globalIndex = sameTypeNodes.findIndex(n => n.id === node.id);
                const base = baseRadius[node.type] || 200;
                const spread = base * (node.type === 'galaxy-core' ? 0.6 : 0.3);
                const offset = sameTypeNodes.length > 1 ? (globalIndex / (sameTypeNodes.length - 1) - 0.5) * spread : 0;
                orbitRadius = base + offset;
            } else {
                const base = baseRadius[node.type] || 50;
                const visualDiameter = node.type === 'satellite' ? 7 : 4;
                const minGap = visualDiameter + 2;
                const neededSpread = Math.max(base * 0.5, (siblingCount - 1) * minGap);
                const offset = siblingCount > 1 ? (siblingIndex / (siblingCount - 1) - 0.5) * neededSpread : 0;
                orbitRadius = base + offset;
            }

            const inclination = node.type === 'asteroid' ?
                (Math.random() - 0.5) * 1.4 :
                (Math.random() - 0.5) * 0.4;

            const eccentricity = node.type === 'comet' ? 0.5 + Math.random() * 0.3 : Math.random() * 0.15;

            node.orbitParams = {
                parentId: parentId,
                orbitRadius: orbitRadius,
                orbitInclination: inclination,
                orbitEccentricity: eccentricity,
                orbitAngle: (Math.PI * 2 / siblingCount) * siblingIndex + (Math.random() - 0.5) * 0.3,
                orbitSpeed: 0,
                level: level
            };

            let centralMass = 1000;
            if (parentId) {
                const parent = nodes.find(n => n.id === parentId);
                if (parent) centralMass = parent.mass;
            }
            node.orbitParams.orbitSpeed = PhysicsEngine.orbitalAngularVelocity(centralMass, orbitRadius);
        });
    }

    createStarfield() {
        const count = 10000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const radius = 500 + Math.random() * 4500;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi);

            const t = Math.random();
            colors[i3] = 0.6 + t * 0.4;
            colors[i3 + 1] = 0.7 + t * 0.3;
            colors[i3 + 2] = 1.0;

            sizes[i] = 0.5 + Math.random() * 1.5;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
            },
            vertexShader: `
                attribute float size;
                attribute float phase;
                varying vec3 vColor;
                uniform float uTime;
                uniform float uPixelRatio;

                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + phase);
                    gl_PointSize = size * uPixelRatio * twinkle * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;

                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;
                    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
                    gl_FragColor = vec4(vColor, alpha * 0.8);
                }
            `,
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);
    }

    createBodies() {
        if (!this.data || !this.data.nodes) return;

        this.data.nodes.forEach(node => {
            const body = this.createBody(node);
            if (body) {
                this.bodies.set(node.id, body);
            }
        });
    }

    createBody(node) {
        const group = new THREE.Group();
        group.userData = {
            body: node,
            id: node.id,
            originalScale: 1
        };

        const visualRadius = this.getVisualRadius(node.type, node.importance || 5);

        const geometry = new THREE.SphereGeometry(visualRadius, 32, 32);
        const bodyColor = node.color || this.getDefaultColor(node.type);
        const material = new THREE.MeshBasicMaterial({
            color: bodyColor
        });
        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);

        if ((node.importance || 0) >= 7) {
            const glowGeometry = new THREE.SphereGeometry(visualRadius * 1.5, 32, 32);
            const glowMaterial = new THREE.MeshBasicMaterial({
                color: node.color || this.getDefaultColor(node.type),
                transparent: true,
                opacity: 0.2,
                side: THREE.BackSide,
                blending: THREE.AdditiveBlending
            });
            const glow = new THREE.Mesh(glowGeometry, glowMaterial);
            group.add(glow);
        }

        if (node.orbitParams) {
            const pos = PhysicsEngine.calculateEllipticalPosition(
                node.orbitParams.orbitRadius,
                node.orbitParams.orbitAngle,
                node.orbitParams.orbitEccentricity,
                node.orbitParams.orbitInclination
            );

            if (node.orbitParams.parentId && this.bodies.has(node.orbitParams.parentId)) {
                const parent = this.bodies.get(node.orbitParams.parentId);
                pos.add(parent.mesh.position);
            }

            group.position.copy(pos);
        }

        this.scene.add(group);

        let label = null;
        if ((node.importance || 0) >= 8) {
            label = this.createLabel(node.name, node.color);
            label.position.copy(group.position).add(new THREE.Vector3(0, visualRadius + 3, 0));
            this.scene.add(label);
        }

        return {
            mesh: group,
            data: node,
            visualRadius: visualRadius,
            label: label,
            orbitParams: node.orbitParams,
            glow: null
        };
    }

    createLabel(text, color) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const fontSize = 14;
        ctx.font = `500 ${fontSize}px "Inter", sans-serif`;
        const metrics = ctx.measureText(text);
        const width = metrics.width + 20;
        const height = fontSize + 12;

        canvas.width = width;
        canvas.height = height;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        ctx.fillStyle = color || '#ffffff';
        ctx.font = `500 ${fontSize}px "Inter", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, width / 2, height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(width / 10, height / 10, 1);

        return sprite;
    }

    createOrbitLines() {
        this.bodies.forEach((body, id) => {
            if (!body.orbitParams || body.data.type === 'blackhole') return;

            const params = body.orbitParams;
            const points = [];
            const segments = 128;

            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                const pos = PhysicsEngine.calculateEllipticalPosition(
                    params.orbitRadius,
                    angle,
                    params.orbitEccentricity,
                    params.orbitInclination
                );
                points.push(pos);
            }

            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const opacity = body.data.type === 'galaxy-core' ? 0.25 :
                           body.data.type === 'satellite' ? 0.12 : 0.06;
            const material = new THREE.LineBasicMaterial({
                color: body.data.color || this.getDefaultColor(body.data.type),
                transparent: true,
                opacity: opacity
            });

            const line = new THREE.Line(geometry, material);

            if (params.parentId && this.bodies.has(params.parentId)) {
                const parent = this.bodies.get(params.parentId);
                line.position.copy(parent.mesh.position);
            }

            this.scene.add(line);
            this.orbitLines.push({ line, bodyId: id, parentId: params.parentId });
        });
    }

    createBlackHole() {
        const geometry = new THREE.SphereGeometry(8, 64, 64);
        const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
        this.blackHole = new THREE.Mesh(geometry, material);
        this.scene.add(this.blackHole);

        const glowGeometry = new THREE.SphereGeometry(10, 64, 64);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xff2200,
            transparent: true,
            opacity: 0.6,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.scene.add(glow);

        const diskGeometry = new THREE.RingGeometry(12, 20, 64);
        const diskMaterial = new THREE.MeshBasicMaterial({
            color: 0xff4400,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        this.accretionDisk = new THREE.Mesh(diskGeometry, diskMaterial);
        this.accretionDisk.rotation.x = Math.PI / 2;
        this.scene.add(this.accretionDisk);
    }

    getVisualRadius(type, importance) {
        const baseRadius = {
            'blackhole': 8,
            'galaxy-core': 5,
            'satellite': 3,
            'asteroid': 1.5,
            'comet': 2.5
        };
        const base = baseRadius[type] || 2;
        return base * (0.8 + importance / 10);
    }

    getDefaultColor(type) {
        const colors = {
            'blackhole': 0x000000,
            'galaxy-core': 0xffaa44,
            'satellite': 0xffffff,
            'asteroid': 0x88ccff,
            'comet': 0x00ffcc
        };
        return colors[type] || 0xffffff;
    }

    update(delta, elapsed) {
        if (this.isPaused) return;

        this.physics.update(this.bodies, delta, this.timeScale);

        this.orbitLines.forEach(({ line, parentId }) => {
            if (parentId && this.bodies.has(parentId)) {
                const parent = this.bodies.get(parentId);
                line.position.copy(parent.mesh.position);
            } else if (!parentId) {
                line.position.set(0, 0, 0);
            }
        });

        if (this.accretionDisk) {
            this.accretionDisk.rotation.z += delta * 0.1 * this.timeScale;
        }

        if (this.starfield) {
            this.starfield.material.uniforms.uTime.value = elapsed;
        }
    }

    setTimeScale(scale) {
        this.timeScale = scale;
    }

    setPaused(paused) {
        this.isPaused = paused;
    }

    filterNodes(visibleIds) {
        this.bodies.forEach((body, id) => {
            const visible = visibleIds.includes(id);
            body.mesh.visible = visible;
            if (body.label) body.label.visible = visible;
        });

        this.orbitLines.forEach(({ line, bodyId }) => {
            line.visible = visibleIds.includes(bodyId);
        });
    }

    getBodyById(id) {
        return this.bodies.get(id);
    }

    getAllBodies() {
        return Array.from(this.bodies.values());
    }
}

class InteractionManager {
    constructor(renderer, scene) {
        this.renderer = renderer;
        this.scene = scene;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.hoveredBody = null;
        this.selectedBody = null;
        this.tooltip = null;
        this.meshList = [];
    }

    setupEventListeners() {
        const canvas = this.renderer.renderer.domElement;

        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        canvas.addEventListener('click', (e) => this.onClick(e));

        this.createTooltip();
        this.updateMeshList();
    }

    createTooltip() {
        this.tooltip = document.createElement('div');
        this.tooltip.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.85);
            border: 1px solid rgba(0, 212, 255, 0.3);
            border-radius: 4px;
            padding: 8px 12px;
            color: #fff;
            font-size: 12px;
            font-family: 'Inter', sans-serif;
            pointer-events: none;
            z-index: 1000;
            display: none;
            backdrop-filter: blur(8px);
            max-width: 200px;
        `;
        document.body.appendChild(this.tooltip);
    }

    updateMeshList() {
        this.meshList = [];
        this.scene.bodies.forEach((body, id) => {
            if (body.mesh) {
                body.mesh.traverse((child) => {
                    if (child.isMesh) {
                        child.userData.bodyId = id;
                        this.meshList.push(child);
                    }
                });
            }
        });
    }

    onMouseMove(event) {
        const rect = this.renderer.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
        const intersects = this.raycaster.intersectObjects(this.meshList);

        if (intersects.length > 0) {
            const obj = intersects[0].object;
            const bodyId = obj.userData.bodyId;
            const body = this.scene.bodies.get(bodyId);

            if (body && this.hoveredBody !== body) {
                if (this.hoveredBody) {
                    this.setBodyScale(this.hoveredBody, 1);
                }

                this.hoveredBody = body;
                this.setBodyScale(body, 1.3);

                this.showTooltip(event, body);

                document.body.style.cursor = 'pointer';
            }
        } else {
            if (this.hoveredBody) {
                this.setBodyScale(this.hoveredBody, 1);
                this.hoveredBody = null;
                this.hideTooltip();
                document.body.style.cursor = 'default';
            }
        }
    }

    onClick(event) {
        if (this.hoveredBody) {
            if (this.selectedBody && this.selectedBody !== this.hoveredBody) {
                this.setBodyEmissive(this.selectedBody, null);
            }

            this.selectedBody = this.hoveredBody;
            this.setBodyEmissive(this.selectedBody, 0x00ff88);

            window.eventBus.emit('body:select', {
                id: this.selectedBody.data.id,
                name: this.selectedBody.data.name,
                type: this.selectedBody.data.type,
                description: this.selectedBody.data.description,
                importance: this.selectedBody.data.importance,
                field: this.selectedBody.data.field,
                mass: this.selectedBody.data.mass,
                orbitParams: this.selectedBody.orbitParams,
                parentId: this.selectedBody.orbitParams?.parentId,
                children: this.getChildren(this.selectedBody.data.id)
            });
        } else {
            if (this.selectedBody) {
                this.setBodyEmissive(this.selectedBody, null);
                this.selectedBody = null;
                window.eventBus.emit('body:deselect');
            }
        }
    }

    setBodyScale(body, scale) {
        if (!body || !body.mesh) return;
        body.mesh.scale.setScalar(scale);
    }

    setBodyEmissive(body, color) {
        if (!body || !body.mesh) return;
        body.mesh.traverse((child) => {
            if (child.isMesh && child.material && child.material.color) {
                if (color) {
                    child.material.color.set(color);
                    child.material.transparent = true;
                    child.material.opacity = 0.9;
                } else {
                    const originalColor = body.data.color || this.getDefaultColor(body.data.type);
                    child.material.color.set(originalColor);
                    child.material.transparent = false;
                    child.material.opacity = 1.0;
                }
            }
        });
    }

    showTooltip(event, body) {
        if (!this.tooltip || !body) return;

        const params = body.orbitParams;
        const parentName = params?.parentId ?
            this.scene.bodies.get(params.parentId)?.data.name || '中心黑洞' : '无';

        this.tooltip.innerHTML = `
            <div style="font-weight: 600; color: #00d4ff; margin-bottom: 4px;">${body.data.name}</div>
            <div style="color: rgba(255,255,255,0.6);">类型: ${this.getTypeLabel(body.data.type)}</div>
            <div style="color: rgba(255,255,255,0.6);">领域: ${body.data.field}</div>
            ${params ? `
            <div style="color: rgba(255,255,255,0.6);">轨道半径: ${params.orbitRadius.toFixed(1)} AU</div>
            <div style="color: rgba(255,255,255,0.6);">父天体: ${parentName}</div>
            ` : ''}
        `;

        this.tooltip.style.left = (event.clientX + 15) + 'px';
        this.tooltip.style.top = (event.clientY + 15) + 'px';
        this.tooltip.style.display = 'block';
    }

    hideTooltip() {
        if (this.tooltip) this.tooltip.style.display = 'none';
    }

    getTypeLabel(type) {
        const labels = {
            'blackhole': '中心黑洞',
            'galaxy-core': '星系核心',
            'satellite': '卫星',
            'asteroid': '小行星',
            'comet': '彗星'
        };
        return labels[type] || type;
    }

    getChildren(parentId) {
        const children = [];
        this.scene.bodies.forEach((body, id) => {
            if (body.orbitParams?.parentId === parentId) {
                children.push({
                    id: body.data.id,
                    name: body.data.name,
                    type: body.data.type
                });
            }
        });
        return children;
    }
}

class UIManager {
    constructor() {
        this.elements = {};
        this.currentSpeed = 1;
        this.isPlaying = true;
    }

    init(data) {
        this.cacheElements();
        this.bindEvents();
        this.updateStats(data);
    }

    cacheElements() {
        const ids = [
            'info-panel', 'info-name', 'info-type', 'info-field', 'info-description',
            'info-orbit-radius', 'info-related',
            'info-close', 'btn-play', 'btn-rewind', 'btn-forward',
            'time-slider', 'time-display', 'search-input', 'search-results',
            'filter-toggle', 'filter-panel',
            'stat-nodes', 'stat-distance', 'stat-fps'
        ];

        ids.forEach(id => {
            this.elements[id] = document.getElementById(id);
        });

        this.speedButtons = document.querySelectorAll('.speed-preset-btn');
        this.viewButtons = document.querySelectorAll('.view-preset-btn');
    }

    bindEvents() {
        if (this.elements['info-close']) {
            this.elements['info-close'].addEventListener('click', () => {
                this.hideInfoPanel();
            });
        }

        if (this.elements['btn-play']) {
            this.elements['btn-play'].addEventListener('click', () => {
                this.isPlaying = !this.isPlaying;
                this.elements['btn-play'].textContent = this.isPlaying ? '⏸' : '▶';
                window.eventBus.emit('time:pause', !this.isPlaying);
            });
        }

        this.speedButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const speed = parseFloat(btn.dataset.speed);
                this.setSpeed(speed);
            });
        });

        this.viewButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                window.eventBus.emit('view:preset', view);
            });
        });

        if (this.elements['search-input']) {
            this.elements['search-input'].addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
        }

        if (this.elements['filter-toggle']) {
            this.elements['filter-toggle'].addEventListener('click', () => {
                const panel = this.elements['filter-panel'];
                if (panel) {
                    panel.classList.toggle('visible');
                }
            });
        }

        window.eventBus.on('body:select', (data) => this.showInfoPanel(data));
        window.eventBus.on('body:deselect', () => this.hideInfoPanel());
    }

    setSpeed(speed) {
        this.currentSpeed = speed;
        window.eventBus.emit('time:scale', speed);

        this.speedButtons.forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
        });
    }

    showInfoPanel(data) {
        const panel = this.elements['info-panel'];
        if (!panel) return;

        if (this.elements['info-name']) {
            this.elements['info-name'].textContent = data.name;
        }
        if (this.elements['info-type']) {
            this.elements['info-type'].textContent = this.getTypeLabel(data.type);
        }
        if (this.elements['info-field']) {
            this.elements['info-field'].textContent = data.field;
        }
        if (this.elements['info-description']) {
            this.elements['info-description'].textContent = data.description || '暂无描述';
        }
        if (this.elements['info-orbit-radius']) {
            this.elements['info-orbit-radius'].textContent =
                data.orbitParams ? data.orbitParams.orbitRadius.toFixed(1) + ' AU' : '中心';
        }
        if (this.elements['info-related']) {
            const related = [];
            if (data.parentId) {
                const parentBody = window.galaxyApp.scene.bodies.get(data.parentId);
                if (parentBody) {
                    related.push(`<span class="related-tag parent-tag" data-id="${data.parentId}">⬆ ${parentBody.data.name}</span>`);
                }
            }
            if (data.children && data.children.length > 0) {
                data.children.forEach(c => {
                    related.push(`<span class="related-tag child-tag" data-id="${c.id}">⬇ ${c.name}</span>`);
                });
            }
            this.elements['info-related'].innerHTML = related.length > 0 ? related.join('') : '无';

            this.elements['info-related'].querySelectorAll('.related-tag').forEach(tag => {
                tag.style.cursor = 'pointer';
                tag.addEventListener('click', () => {
                    const targetId = tag.dataset.id;
                    const targetBody = window.galaxyApp.scene.bodies.get(targetId);
                    if (targetBody) {
                        const pos = targetBody.mesh.position.clone();
                        window.galaxyApp.renderer.controls.target.copy(pos);
                        window.galaxyApp.renderer.camera.position.copy(pos).add(new THREE.Vector3(0, 50, 100));
                        window.eventBus.emit('body:select', {
                            id: targetBody.data.id,
                            name: targetBody.data.name,
                            type: targetBody.data.type,
                            description: targetBody.data.description,
                            importance: targetBody.data.importance,
                            field: targetBody.data.field,
                            orbitParams: targetBody.orbitParams,
                            parentId: targetBody.orbitParams?.parentId,
                            children: window.galaxyApp.interaction.getChildren(targetBody.data.id)
                        });
                    }
                });
            });
        }

        panel.classList.add('visible');
    }

    hideInfoPanel() {
        const panel = this.elements['info-panel'];
        if (panel) panel.classList.remove('visible');
    }

    handleSearch(query) {
        const results = this.elements['search-results'];
        if (!results) return;

        if (!query || query.length < 2) {
            results.style.display = 'none';
            return;
        }

        window.eventBus.emit('search:query', query);
    }

    updateStats(data) {
        if (this.elements['stat-nodes'] && data && data.nodes) {
            this.elements['stat-nodes'].textContent = data.nodes.length;
        }
    }

    updateFPS(fps) {
        if (this.elements['stat-fps']) {
            this.elements['stat-fps'].textContent = Math.round(fps);
        }
    }

    updateDistance(distance) {
        if (this.elements['stat-distance']) {
            this.elements['stat-distance'].textContent = distance.toFixed(1);
        }
    }

    getTypeLabel(type) {
        const labels = {
            'blackhole': '中心黑洞',
            'galaxy-core': '星系核心',
            'satellite': '卫星',
            'asteroid': '小行星',
            'comet': '彗星'
        };
        return labels[type] || type;
    }
}

window.eventBus = new EventBus();

(async () => {
    const container = document.getElementById('galaxy-container');
    if (!container) {
        console.error('[Knowledge Cosmos] 找不到 galaxy-container');
        return;
    }

    const renderer = new GalaxyRenderer(container);
    await renderer.init();

    const scene = new GalaxyScene(renderer);
    const data = await scene.loadData();
    scene.build();

    const interaction = new InteractionManager(renderer, scene);
    interaction.setupEventListeners();

    const ui = new UIManager();
    ui.init(data);

    window.eventBus.on('time:scale', (scale) => scene.setTimeScale(scale));
    window.eventBus.on('time:pause', (paused) => scene.setPaused(paused));

    window.eventBus.on('view:preset', (preset) => {
        const camera = renderer.camera;
        const controls = renderer.controls;

        const targetPositions = {
            'top':    new THREE.Vector3(0, 400, 0.1),
            'side':   new THREE.Vector3(400, 50, 0),
            'free':   new THREE.Vector3(0, 150, 300)
        };

        const targetPos = targetPositions[preset] || targetPositions['free'];
        const startPos = camera.position.clone();
        const startTarget = controls.target.clone();
        const endTarget = new THREE.Vector3(0, 0, 0);

        const origDamping = controls.enableDamping;
        controls.enableDamping = false;

        let progress = 0;
        const duration = 800;
        const startTime = performance.now();

        function animateView(now) {
            progress = Math.min(1, (now - startTime) / duration);
            const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            camera.position.lerpVectors(startPos, targetPos, t);
            controls.target.lerpVectors(startTarget, endTarget, t);
            controls.update();

            if (progress < 1) {
                requestAnimationFrame(animateView);
            } else {
                controls.enableDamping = origDamping;
            }
        }

        requestAnimationFrame(animateView);

        document.querySelectorAll('.view-preset-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === preset);
        });
    });

    window.eventBus.on('search:query', (query) => {
        const results = [];
        scene.bodies.forEach((body, id) => {
            if (body.data.name.toLowerCase().includes(query.toLowerCase())) {
                results.push({ id, name: body.data.name });
            }
        });
        const searchResults = document.getElementById('search-results');
        if (searchResults) {
            searchResults.innerHTML = results.map(r =>
                `<div class="search-result-item" data-id="${r.id}">${r.name}</div>`
            ).join('');
            searchResults.style.display = results.length > 0 ? 'block' : 'none';

            searchResults.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const targetId = item.dataset.id;
                    const targetBody = scene.bodies.get(targetId);
                    if (!targetBody) return;

                    searchResults.style.display = 'none';
                    const searchInput = document.getElementById('search-input');
                    if (searchInput) searchInput.value = '';

                    const targetPos = targetBody.mesh.position.clone();
                    const camera = renderer.camera;
                    const controls = renderer.controls;

                    const startPos = camera.position.clone();
                    const startTarget = controls.target.clone();
                    const offset = new THREE.Vector3(0, 30, 60);
                    const endPos = targetPos.clone().add(offset);
                    const endTarget = targetPos.clone();

                    const origDamping = controls.enableDamping;
                    controls.enableDamping = false;

                    let progress = 0;
                    const duration = 600;
                    const startTime = performance.now();

                    function animateCamera(now) {
                        progress = Math.min(1, (now - startTime) / duration);
                        const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

                        camera.position.lerpVectors(startPos, endPos, t);
                        controls.target.lerpVectors(startTarget, endTarget, t);
                        controls.update();

                        if (progress < 1) {
                            requestAnimationFrame(animateCamera);
                        } else {
                            controls.enableDamping = origDamping;
                            window.eventBus.emit('body:select', {
                                id: targetBody.data.id,
                                name: targetBody.data.name,
                                type: targetBody.data.type,
                                description: targetBody.data.description,
                                importance: targetBody.data.importance,
                                field: targetBody.data.field,
                                orbitParams: targetBody.orbitParams,
                                parentId: targetBody.orbitParams?.parentId,
                                children: window.galaxyApp.interaction.getChildren(targetBody.data.id)
                            });
                        }
                    }
                    requestAnimationFrame(animateCamera);
                });
            });
        }
    });

    let frameCount = 0;
    let lastTime = performance.now();

    renderer.addUpdateCallback((delta, elapsed) => {
        scene.update(delta, elapsed);

        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
            ui.updateFPS(frameCount);
            frameCount = 0;
            lastTime = now;
        }

        const dist = renderer.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
        ui.updateDistance(dist);
    });

    renderer.start();

    window.galaxyApp = {
        renderer,
        scene,
        interaction,
        ui,
        eventBus: window.eventBus
    };

    setTimeout(() => {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('fade-out');
            setTimeout(() => overlay.remove(), 600);
        }
    }, 1500);

    console.log('[Knowledge Cosmos] 初始化完成');
})();
