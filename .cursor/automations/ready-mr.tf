terraform {
  required_providers {
    cursor = {
      source  = "cursor/cursor"
      version = "~> 0.1"
    }
  }
}

provider "cursor" {}

# PR triggers infer the repo and head from the merge request.
# git_repo / git_branch are only for non-git triggers; do not pin this to main.
resource "cursor_platform_workflow" "ready_mr_tests" {
  name        = "Ready MR checklist"
  description = "On a ready merge request, run that MR's incomplete checklist without changing files, then review and tick what passed."
  scope       = "user"
  enabled     = true

  prompt                 = file("${path.module}/ready-mr.md")
  environment_public_id  = "49ea959f-b7ee-11f1-bb68-864e54d14197"
  disabled_default_tools = ["open_git_pr"]

  trigger = [
    {
      git_pull_request = {
        repos            = ["horib/gardener"]
        pr_action        = "opened"
        ignore_draft_prs = true
      }
    }
  ]

  action = [
    {
      pr_comment = {
        allow_inline_comments = true
        allow_approve         = false
      }
    }
  ]
}
