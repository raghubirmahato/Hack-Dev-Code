
## Confirm before publishing

After checking the details below, click **Review deployments**, select <code>desktop-test</code>, and click **Approve and deploy**. Click **Reject** if anything is wrong.

| Item | Publication details |
| --- | --- |
| Publication environment | <code>test</code> |
| Version | <code>1.0.0</code> |
| Update channel | <code>nightly</code> |
| Platform | <code>win-x64</code> |
| Test release ID | <code>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</code><br>Random prefix for the test download path that makes the URL harder to guess; consecutive upgrade tests must reuse the same value. |
| Download URL preview | <a href="https&#58;//example.com/dsh-desk/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bin/win-x64/hack-dev-code-1.0.0-win-x64.exe">https&#58;//example.com/dsh-desk/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bin/win-x64/hack-dev-code-1.0.0-win-x64.exe</a><br>Target URLs after publication; downloads are not guaranteed before approval. |
| Update YAML | <a href="https&#58;//example.com/dsh-desk/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/feeds/win-x64/nightly.yml">https&#58;//example.com/dsh-desk/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/feeds/win-x64/nightly.yml</a><br>This publication updates the file; before approval it may not exist yet or may still point at an older release. |
| Packaging source | <a href="https&#58;//github.com/owner/repo/actions/runs/10/attempts/2">View packaging run #10 · attempt 2</a><br>Source: <code>master @ bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb</code><br>Packaging machine: <code>fixture-runner</code> |
| Signature and notarization | EXE signature verified |
| Git tag | Not created (test environment) |

### After approval

1. Re-validate the artifacts and publication targets; stop if they differ from this approval summary.
2. Upload missing files and skip existing files whose contents match; stop if any content conflicts.
3. Update the update YAML above and save the publication record.

**This publication targets test only and does not modify production.**

<details>
<summary>Technical details and file list</summary>

COS bucket: <code>fixture-1250000000</code>

The release ID comes from the original packaging artifact manifest. Packaging prefers the `test_release_id` form field; when it is blank, packaging uses `DOWNLOAD_TEST_RELEASE_ID` from the machine's `presets/test.env`. Publication does not choose it again.

Approval summary SHA-256: <code>cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc</code>

Total: 3 files. Size and SHA-256 describe the bytes that are actually uploaded, including the updated YAML content.

| File | Size | SHA-256 |
| --- | --- | --- |
| <a href="https&#58;//example.com/dsh-desk/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bin/win-x64/hack-dev-code-1.0.0-win-x64.exe">hack-dev-code-1.0.0-win-x64.exe</a> | 23 bytes | <code>7039e7b3e00d39fbfb2948ba31b6216ac9ffff01b4117a1cec08025255d9ad10</code> |
| <a href="https&#58;//example.com/dsh-desk/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bin/win-x64/hack-dev-code-1.0.0-win-x64.exe.blockmap">hack-dev-code-1.0.0-win-x64.exe.blockmap</a> | 16 bytes | <code>4fd6c7d73e713d7f54f173dfc845d046d267f9e62c80a92670b0696131bfb74a</code> |
| <a href="https&#58;//example.com/dsh-desk/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/feeds/win-x64/nightly.yml">nightly.yml</a> | 269 bytes | <code>13a30637863ec166e30e409c4ed97cbbc817578483a8c9860e13d212ae7ea30a</code> |

</details>

If the repository is public, the download URLs in this summary and the release ID of a test publication are public too. A random prefix does not replace access control.
