
## Confirm before publishing

After checking the details below, click **Review deployments**, select <code>desktop-production</code>, and click **Approve and deploy**. Click **Reject** if anything is wrong.

| Item | Publication details |
| --- | --- |
| Publication environment | <code>production</code> |
| Version | <code>1.0.0</code> |
| Update channel | <code>latest</code> |
| Platform | <code>win-x64</code> |
| Download URL preview | <a href="https&#58;//download.example.com/dsh-desk/bin/win-x64/latest/hack-dev-code-1.0.0-win-x64.exe">https&#58;//download.example.com/dsh-desk/bin/win-x64/latest/hack-dev-code-1.0.0-win-x64.exe</a><br>Target URLs after publication; downloads are not guaranteed before approval. |
| Update YAML | <a href="https&#58;//download.example.com/dsh-desk/feeds/win-x64/latest.yml">https&#58;//download.example.com/dsh-desk/feeds/win-x64/latest.yml</a><br>This publication updates the file; before approval it may not exist yet or may still point at an older release. |
| Packaging source | <a href="https&#58;//github.com/owner/repo/actions/runs/20/attempts/3">View packaging run #20 · attempt 3</a><br>Source: <code>dsh-v1.0.0 @ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</code><br>Packaging machine: <code>windows-publisher</code> |
| Signature and notarization | EXE signature verified |
| Git tag | <code>desktop-v1.0.0</code> |

### After approval

1. Re-validate the artifacts and publication targets; stop if they differ from this approval summary.
2. Upload missing files and skip existing files whose contents match; stop if any content conflicts.
3. Update the update YAML above and save the publication record.
4. Create the Git tag above for the packaged commit; if creating the tag fails, record "published, tag pending".

<details>
<summary>Technical details and file list</summary>

COS bucket: <code>production-1234567890</code>

Approval summary SHA-256: <code>cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc</code>

Total: 2 files. Size and SHA-256 describe the bytes that are actually uploaded, including the updated YAML content.

| File | Size | SHA-256 |
| --- | --- | --- |
| <a href="https&#58;//download.example.com/dsh-desk/bin/win-x64/latest/hack-dev-code-1.0.0-win-x64.exe">hack-dev-code-1.0.0-win-x64.exe</a> | 15 bytes | <code>e34210a6de4f653edf588301431c3d69a633638cbf587345cc50a7fed9f38f4c</code> |
| <a href="https&#58;//download.example.com/dsh-desk/feeds/win-x64/latest.yml">latest.yml</a> | 15 bytes | <code>8850e6075dda0080c526269a4de29848c32c2a65e3d81f4a64ed8ce53d4b47c1</code> |

</details>

If the repository is public, the download URLs in this summary and the release ID of a test publication are public too. A random prefix does not replace access control.
