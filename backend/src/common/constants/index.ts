export * from './permissions';

/** All JSON APIs live under this prefix (file-serving routes /p and /d do not). */
export const API_PREFIX = 'api/v1';

export const API_KEY_LIVE_PREFIX = 'cs_live_';

/** Header a dashboard (JWT) client uses to pick which project a files/folders request targets. */
export const PROJECT_HEADER = 'x-project-id';
