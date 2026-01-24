# VPS Setup Guide for Sonata Loop

Run `sonata loop` autonomously on a VPS without needing a constant connection from your local machine.

## Prerequisites

| Tool        | Install Command                                                                                    | Verify               |
| ----------- | -------------------------------------------------------------------------------------------------- | -------------------- |
| Node.js 18+ | `curl -fsSL https://deb.nodesource.com/setup_18.x \| sudo -E bash - && sudo apt install -y nodejs` | `node --version`     |
| Git         | Usually pre-installed                                                                              | `git --version`      |
| tmux        | `sudo apt install tmux`                                                                            | `tmux -V`            |
| GitHub CLI  | [See below](#github-cli-install)                                                                   | `gh --version`       |
| OpenCode    | `npm install -g opencode-ai`                                                                       | `opencode --version` |
| Sonata      | `npm install -g sonata`                                                                            | `sonata --version`   |

---

## GitHub CLI Install

Official install for Ubuntu/Debian:

```bash
(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && sudo mkdir -p -m 755 /etc/apt/sources.list.d \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt update \
  && sudo apt install gh -y
```

---

## Authentication Setup

### 1. Git Identity

Required for commits:

```bash
git config --global user.email "you@example.com"
git config --global user.name "Your Name"
```

> **Tip:** Consider using `"Your Name (Sonata)"` to distinguish AI-assisted commits.

### 2. Deploy Key for Git Push

Generate a deploy key for your repository:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_myproject -C "sonata-vps"
cat ~/.ssh/deploy_myproject.pub
```

Add the public key to your repository:

- Go to `github.com/<org>/<repo>/settings/keys`
- Click "Add deploy key"
- Enable "Allow write access"
- Paste the public key

Verify it works:

```bash
ssh -T git@github.com
# Should see: "Hi <user>/<repo>! You've successfully authenticated..."
```

### 3. GitHub CLI for PR Creation

Create a **fine-grained PAT** with minimal permissions:

1. Go to: https://github.com/settings/tokens?type=beta
2. **Generate new token**
3. Name: `sonata-vps-pr`
4. Expiration: 1 year
5. Repository access: **Only select repositories** → pick your project
6. Permissions:
   - **Pull requests**: Read and write
   - (That's all - deploy key handles git push)
7. Generate → Copy token

Authenticate:

```bash
gh auth login
# Select: GitHub.com
# Select: HTTPS
# Select: Paste an authentication token
# Paste your token
```

Verify:

```bash
gh auth status
```

### 4. OpenCode

```bash
opencode auth login
# Select provider (Anthropic/Claude)
# Use device code flow or paste API key
```

### 5. Notion MCP (if using Notion mode)

```bash
opencode mcp auth notion
# Opens browser flow - complete OAuth on your phone/PC
```

---

## Project Setup

```bash
# Clone using SSH (uses deploy key)
git clone git@github.com:youruser/yourproject.git
cd yourproject

# Configure Sonata
sonata setup
```

---

## Pre-flight Check Script

Save as `~/check-sonata.sh`:

```bash
#!/bin/bash
echo "=== Sonata Pre-flight Check ==="

echo -n "Node.js: "; node --version || echo "MISSING"
echo -n "Git: "; git --version | head -1 || echo "MISSING"
echo -n "OpenCode: "; opencode --version 2>/dev/null || echo "MISSING"
echo -n "GitHub CLI: "; gh --version | head -1 || echo "MISSING"
echo -n "Sonata: "; sonata --version 2>/dev/null || echo "MISSING"

echo ""
echo "=== Auth Status ==="
gh auth status 2>&1 | head -3
echo ""
echo -n "Git user.email: "; git config --global user.email || echo "NOT SET"
echo -n "Git user.name: "; git config --global user.name || echo "NOT SET"

echo ""
echo "=== SSH (Deploy Key) ==="
ssh -T git@github.com 2>&1 | head -1
```

Make it executable and run:

```bash
chmod +x ~/check-sonata.sh
bash ~/check-sonata.sh
```

---

## Running the Loop

### Start a tmux Session

```bash
# Start tmux session
tmux new -s sonata

# Navigate to project
cd ~/yourproject

# Run autonomous loop
sonata loop 20  # 20 iterations max

# Detach: Ctrl+B, then D
# Your laptop can now disconnect - loop keeps running
```

### Reconnecting

```bash
ssh user@your-vps
tmux attach -t sonata
```

---

## Authentication Summary

| Component   | Method           | Expiration            |
| ----------- | ---------------- | --------------------- |
| Git push    | Deploy key (SSH) | Never                 |
| PR creation | Fine-grained PAT | 1 year                |
| OpenCode AI | API key          | Depends on provider   |
| Notion      | OAuth token      | Never (until revoked) |

---

## Potential Failure Points

| Issue                  | Prevention                         |
| ---------------------- | ---------------------------------- |
| PAT expires            | Set calendar reminder for 1 year   |
| Disk full              | Monitor with `df -h`               |
| No specs/tickets       | Ensure work exists before starting |
| Max iterations reached | Increase with `sonata loop 50`     |
| Git identity not set   | Run git config commands above      |
| SSH key not working    | Test with `ssh -T git@github.com`  |

---

## Quick Reference

```bash
# Start loop in tmux
tmux new -s sonata
cd ~/project
sonata loop 20
# Ctrl+B, D to detach

# Check on progress
ssh user@vps
tmux attach -t sonata

# Kill session when done
tmux kill-session -t sonata
```
