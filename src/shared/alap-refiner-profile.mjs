// Trusted Waypoints policy. Generic query modules contain no bookmark field names.
export const ALAP_SORT_TYPES = Object.freeze({
  label: "string",
  title: "string",
  channel: "string",
  duration: "number",
  posted: "number",
  updated: "number",
});
export const ALAP_SORT_FIELDS = Object.freeze(Object.keys(ALAP_SORT_TYPES));
