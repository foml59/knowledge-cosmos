# Knowledge Cosmos

一个用 Three.js 做的 3D 知识可视化页面，把计算机网络的知识点映射成宇宙里的各种天体——黑洞是核心概念，星系是主题，卫星和小行星是细分知识点。

做这个主要是觉得传统的思维导图太二维了，想试试能不能用空间感来呈现知识之间的层级和关联。

技术栈：
- Three.js 0.170.0
- OrbitControls
- ES Modules（importmap）

怎么跑起来：

```bash
# 随便找个 HTTP 服务器就行
npx serve
# 或者
python -m http.server 8000
```

然后浏览器打开 localhost 对应的端口。

数据放在 `data/computer-network-galaxy.json`，有 126 多个节点，覆盖了：
- 计算机网络基础
- OSI 参考模型
- TCP/IP 协议栈
- IP 地址与路由
- 网络设备和传输介质
- 网络安全
- 网络应用与服务
- 一些新兴技术
