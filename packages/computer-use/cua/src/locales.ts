/** Locale-owned application-access approval messages. */

/** English application-access messages. */
export const en = {
  question: 'Allow agent to control this application via computer use?',
  detail: 'Manage app permissions for all sessions on the plugin page.',
  approve: 'Allow for this session',
}

/** Display translations resolved by the Client; wire choices stay unchanged. */
export const applicationAccessDisplay = {
  question: {
    en: en.question,
  },
  detail: { en: en.detail },
  approve: {
    en: en.approve,
  },
}

/** Window consent never grants access to sibling windows or application launch. */
export const windowAccessQuestion = {
  en: 'Allow computer use to read, capture and control this window?',
}
/** Launch consent does not grant access to resulting windows. */
export const launchAccessQuestion = {
  en: 'Allow computer use to launch this entry? Window access is requested separately.',
}
