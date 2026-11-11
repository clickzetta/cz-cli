# Common misunderstandings

Record evidenced misunderstandings that affect decisions: misconception, actual constraint and source. Read relevant entries before acting.

<a id="安装脚本的地址与版本参数"></a>

## Installer URLs and version arguments

README examples may diverge from the release path. Verify the script's actual URL, response content and argument parsing; do not assume a GitHub release asset exists or an environment variable is read. Test both default and pinned-version examples.

Evidence: [Issue #148](https://github.com/clickzetta/cz-cli/issues/148), [PR #150](https://github.com/clickzetta/cz-cli/pull/150).

<a id="私有部署的认证入口"></a>

## Private deployment authentication

Verify the deployment's endpoint and complete auth response; public-hostname conventions may not apply. Tests returning a token immediately do not cover multi-step auth. MFA/challenges mean authentication is incomplete, not a bad password or success; never disable them to pass a test.

Check [authentication](../domains/authentication.md) and [account endpoint code](../../packages/cz-cli/src/commands/account-login.ts) at the task's source version. New capabilities require the original request and latest product decision; diagnostic advice does not establish support. This entry describes checks, not universal deployment coverage.
