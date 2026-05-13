# 三谋队伍克制分析工具 - 本地开发说明

## 项目信息
- **项目名**：真武团三谋队伍克制分析工具
- **版本**：V1.5
- **技术栈**：纯前端 (HTML + JS) + Node.js 后端

## 服务配置
| 服务 | 端口 | 启动命令 | 文件 |
|------|------|----------|------|
| 前端 | 8080 | `npx serve -l 8080 -s .` | index.html |
| 后端 | 3000 | `node nslg-backend.js` | nslg-backend.js |
| 数据库 | 3306 | MySQL | localhost/nslg_battle |

## 数据库配置
- Host: localhost:3306
- Database: nslg_battle
- User: nslg-battle-server
- Charset: utf8mb4

## 快速启动
```bash
# 方式一：使用脚本
./start-local.ps1

# 方式二：手动启动
# 终端1 - 后端
node nslg-backend.js

# 终端2 - 前端
npx serve -l 8080 -s .
```

## 目录结构
```
E:\nslg-battle4\
├── index.html          # 主前端文件（单文件应用）
├── nslg-backend.js     # 后端 API 服务
├── project-system.js   # 项目管理模块
├── user-system.js      # 用户认证模块
├── data-system.js      # 数据管理模块
├── ocr-system.js       # OCR识别模块
├── counter-analysis.js # 克制分析模块
├── role-system.js      # 角色权限模块
└── cloud-sync.js       # 云端同步模块
```

## 访问地址
- 前端页面：http://localhost:8080
- 后端 API：http://localhost:3000

## 备份目录
- 原项目备份：C:\Users\Administrator\nslg-battle
