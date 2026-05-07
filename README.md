# stars

给自己 Star 过的 GitHub 项目写备注，并把备注保存到仓库中。

## 功能

- 展示 GitHub Star 仓库列表。
- 搜索仓库名称、仓库描述和备注内容。
- 点击仓库卡片上的 `修改备注` 编辑备注。
- 通过 `保存到远端` 把备注提交到仓库的 `data/notes.json`。
- 从 `data/notes.json` 自动载入已有备注。
- 鼠标悬停仓库描述时展示完整描述。

## 工作原理

项目是纯静态页面，没有后端服务：

1. GitHub Actions 定时调用 GitHub API 获取 Star 仓库列表。
2. `scripts/fetchStars.js` 把接口返回数据精简后写入 `data/starred_repos.json`。
3. GitHub Pages 托管 `index.html`，页面读取 `data/starred_repos.json` 渲染列表。
4. 页面启动时读取 `data/notes.json`，把备注合并到对应仓库卡片上。
5. 编辑备注后，浏览器通过 GitHub Contents API 更新仓库里的 `data/notes.json`。

## 目录说明

```text
.
├── .github/workflows/update.yml   # 定时拉取 Star 列表并提交数据
├── data/starred_repos.json        # Star 仓库列表，由 Actions 生成
├── data/notes.json                # 备注数据，由页面远端提交更新
├── index.html                     # 页面入口和弹窗结构
├── scripts/app.js                 # 页面渲染、搜索、备注提交逻辑
├── scripts/fetchStars.js          # GitHub Actions 拉取 Star 数据脚本
└── style/style.css                # 页面样式
```

## 部署

1. 基于这个项目创建你自己的仓库。建议不要直接 fork 后长期跟随原仓库数据，否则 `data` 目录可能被上游数据影响。
2. 打开 GitHub 的 [Personal access tokens](https://github.com/settings/personal-access-tokens) 页面，创建一个 token。
3. token 建议使用 fine-grained personal access token，只授权当前仓库。
4. 给 token 配置权限：
   - Repository permissions：`Contents` 设置为 Read and write。
   - Account permissions：`Starring` 设置为 Read-only。
5. 在当前仓库进入 `Settings` -> `Secrets and variables` -> `Actions`，新增两个 Repository secrets：
   - `GH_TOKEN`：上一步创建的 token。
   - `GH_UNAME`：你的 GitHub 用户名，不是邮箱。
6. 进入 `Actions`，选择 `获取star的项目`，手动执行一次 `Run workflow`，确认能成功生成自己的 `data/starred_repos.json`。
7. 进入 `Settings` -> `Pages`，开启 GitHub Pages。

## 定时任务

`.github/workflows/update.yml` 默认每天自动更新一次 Star 列表：

```yaml
schedule:
  - cron: '17 16 * * *'
```

GitHub Actions 的 cron 使用 UTC 时间。这里的 `16:17 UTC` 对应北京时间每天 `00:17`。没有使用整点，是为了避开 GitHub Actions 整点调度高峰。

也可以在 Actions 页面手动执行 `获取star的项目` workflow。

## 使用

打开 GitHub Pages 地址后即可使用：

1. 页面会读取 `data/starred_repos.json` 并展示仓库列表。
2. 使用顶部搜索框可以搜索仓库名称、仓库描述和备注。
3. 点击仓库卡片右上角的 `修改备注`。
4. 在弹窗中编辑备注。
5. 点击 `保存到远端`，页面会提交更新后的 `data/notes.json` 到仓库。

首次保存到远端前，需要点击顶部 `配置` 按钮填写：

- `GitHub personal token`：需要当前仓库 `Contents` 写入权限。
- `Owner`：GitHub 用户名或组织名。
- `Repo`：当前仓库名。
- `Branch`：要提交到的分支，默认 `main`。

配置会保存在当前浏览器的 IndexedDB 中。

## 数据格式

`data/starred_repos.json` 由 GitHub Actions 生成，每条数据只保留页面需要的字段：

```json
{
  "id": 503827141,
  "html_url": "https://github.com/capcom6/android-sms-gateway",
  "name": "android-sms-gateway",
  "full_name": "capcom6/android-sms-gateway",
  "description": "The SMS Gateway for Android app...",
  "stargazers_count": 4344,
  "language": "Kotlin"
}
```

`data/notes.json` 保存备注数据：

```json
{
  "notes": [
    {
      "id": "503827141",
      "notes": "示例备注"
    }
  ]
}
```

备注用 GitHub 仓库 ID 关联 Star 仓库。

## 本地运行

因为页面通过 `fetch` 读取 `data/*.json`，建议用本地静态服务打开：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000/
```

## 注意事项

- GitHub Pages 不能读取 Actions 里的 `GH_TOKEN` secret，所以浏览器端 `保存到远端` 必须单独填写 token。
- token 会保存在当前浏览器 IndexedDB 中，不建议在不可信设备上配置。
- GitHub Actions 的 `schedule` 不保证严格准点，可能因为平台负载延迟执行。
