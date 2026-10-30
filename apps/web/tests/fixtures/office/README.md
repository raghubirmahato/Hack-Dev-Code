# Binary Office fixtures

`preview.doc`, `preview.xls`, and `preview.ppt` contain the `Office preview <CJK DOCUMENT>` wide-character sample. They are the `one-page.doc`, `one-sheet.xls`, and `one-slide.ppt` fixtures from [LibreOffice Kit](https://github.com/hack-dev-code/dsh-libreoffice-kit), exported from Harness-authored OOXML with LibreOffice 26.8.0.3 using the Word, Excel, and PowerPoint 97 filters. The source documents retain the Harness MIT license.

The browser regression reads these committed OLE files and verifies actual conversion and selectable PDF text. They contain no user documents and require no Office application or fixture generator during tests. They cover simple legacy imports, not complex-document fidelity.
