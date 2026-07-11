const base = {
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export const PagesIcon = () => (
  <svg {...base}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 9v12" />
  </svg>
);

export const ChatIcon = () => (
  <svg {...base}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-4-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
  </svg>
);

export const TrendsIcon = () => (
  <svg {...base}>
    <path d="M3 17l6-6 4 4 7-7" />
    <path d="M14 7h6v6" />
  </svg>
);

export const SavedIcon = () => (
  <svg {...base}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...base} width={15} height={15}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const CollapseIcon = () => (
  <svg {...base} width={15} height={15}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const ExpandIcon = () => (
  <svg {...base} width={15} height={15}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export const AttachIcon = () => (
  <svg {...base} width={18} height={18} strokeWidth={1.6}>
    <path d="M21.4 11.05l-9.19 9.2a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

export const SendIcon = () => (
  <svg {...base} width={16} height={16} strokeWidth={2}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
