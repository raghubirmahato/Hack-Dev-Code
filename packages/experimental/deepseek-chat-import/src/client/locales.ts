/** `deepseekChatImport` namespace dictionaries for the import action and dialog. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deepseekChatImport'

/** The namespace key union. */
export type DeepseekChatImportKey = keyof typeof en

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.label': 'Import DeepSeek chats',
  'dialog.title': 'Import DeepSeek chat history',
  'dialog.description': 'Choose the ZIP file exported from the DeepSeek website (deepseek_data-*.zip) and the workspace that receives the sessions.',
  'dialog.file': 'Export file',
  'dialog.chooseFile': 'Choose file…',
  'dialog.changeFile': 'Change',
  'dialog.workspace': 'Workspace',
  'dialog.chooseWorkspace': 'Choose workspace',
  'dialog.cancel': 'Cancel',
  'dialog.close': 'Close',
  'dialog.import': 'Import',
  'dialog.importing': 'Importing…',
  'dialog.importingCount': 'Importing {done}/{total}',
  'dialog.uploading': 'Uploading {percent}%',
  'dialog.done': 'Done',
  'result.imported.one': 'Imported {count} session into the {name} workspace.',
  'result.imported.other': 'Imported {count} sessions into the {name} workspace.',
  'result.omitted.one': '{count} older conversation exceeded the import limit and was not imported.',
  'result.omitted.other': '{count} older conversations exceeded the import limit and were not imported.',
  'result.skipped.one': '{count} conversation could not be imported.',
  'result.skipped.other': '{count} conversations could not be imported.',
  'error.missing-manifest': 'This is not a DeepSeek export: manifest.json is missing.',
  'error.missing-index': 'This is not a DeepSeek export: chat_session_index.json is missing or unreadable.',
  'error.unsupported-version': 'This export format version is not supported.',
  'error.unreadable-archive': 'The file is not a readable ZIP archive.',
  'error.no-conversations': 'The export contains no conversations that can be imported.',
  'error.too-large': 'The file is too large: the limit is {limit}.',
  'error.workspace-not-found': 'The chosen workspace no longer exists. Choose another one.',
  'error.busy': 'Another import is running. Try again later.',
  'error.upload-failed': 'Upload failed: {message}',
  'error.unknown': 'Import failed: {message}',
}
