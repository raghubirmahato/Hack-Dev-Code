/** Locale-owned application-access approval messages. */

/** English application-access messages. */
export const en = {
  question: 'Allow computer use to launch, read, capture and control this application?',
  detail: 'Allowing or denying applies to every version and copy sharing the same application identity. Session access and denial apply only to this conversation.',
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
