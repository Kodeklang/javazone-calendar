// The published font URLs, so the service worker can precache them by name.
// Templates cannot read a directory, and the faces are generated rather than
// checked in, so the list has to come through the data cascade.

import { fontFiles } from "../../lib/fonts.mjs";

export default () => fontFiles().map((f) => `/css/fonts/${f}`);
