const paths = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h2m4 0h2m-8 3h2"/>',
  patients: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/>',
  treatment: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zm0 8h6m-6 4h6"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-5 5h5m-16-9V3h13"/>',
  stock: '<path d="m12 3 9 5-9 5-9-5 9-5zm9 5v10l-9 5-9-5V8m9 5v10M7 6l10 6"/>',
  reports: '<path d="M4 3v17h17M8 16v-5m5 5V6m5 10v-8"/>',
  users: '<path d="m12 3 8 4v6c0 5-8 8-8 8s-8-3-8-8V7l8-4zm-4 9 3 3 5-6"/>',
  services: '<path d="M20 13 12 21 3 12V3h9l8 8a1.5 1.5 0 0 1 0 2z"/><circle cx="7.5" cy="7.5" r="1"/>',
  logs: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  external: '<path d="M14 3h7v7m0-7-11 11M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4"/>',
  logout: '<path d="M9 4H4v16h5m4-8h9m-4-4 4 4-4 4"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
};
export function adminIcon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.dashboard) + '</svg>';
}
