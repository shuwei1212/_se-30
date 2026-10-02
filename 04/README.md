1. 母專案 -- https://github.com/se-test-wei/git-examples/tree/main
    * 分支 -- https://github.com/se-test-wei/git-examples/tree/developGitBranch
2. 子專案 -- https://github.com/shuwei1212/git-examples/tree/main

# 示範紀錄

## 母專案

### git remote -v
查看目前遠端 Repository 的網址

### git checkout -b developGitBranch
建立 developGitBranch 分支，並切換到該分支

### git branch
查看目前有哪些分支，以及目前所在的分支

### git add *.md
將所有 .md 檔案加入暫存區

### git commit -m "add gitBranch.md"
將暫存區的檔案建立成一個 Commit

### git push origin developGitBranch
將 developGitBranch 分支推送到 GitHub

### git checkout main
切換回 main 分支

### git merge developGitBranch
將 developGitBranch 合併到 main

### git push origin main
將合併後的 main 推送到 GitHub

## 子專案 fork

### git clone git@github.com:shuwei1212/git-examples.git
將 Fork 後的 Repository 複製到電腦

### cd git-examples
進入 git-examples 專案資料夾

### git add .
將所有修改加入暫存區

### git commit -m "add weiFork.md"
將修改建立成一個 Commit

### git push
將本地的修改推送到 GitHub