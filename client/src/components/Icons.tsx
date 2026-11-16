import type { SVGProps } from 'react';

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...props,
});

export const CopyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
  </svg>
);

export const HeartIcon = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
  </svg>
);

export const SparkIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />
  </svg>
);

export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const RetryIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </svg>
);

export const ArrowIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ForgeMark = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 28, height: 28, viewBox: '0 0 32 32', ...p })}>
    <circle cx="16" cy="16" r="12" strokeWidth="1.4" opacity="0.55" />
    <ellipse cx="16" cy="16" rx="14.5" ry="5.2" transform="rotate(-18 16 16)" strokeWidth="1.2" opacity="0.9" />
    <path d="M11.5 21V11l9 10V11" strokeWidth="2" />
  </svg>
);

const typeIconPaths: Record<string, string> = {
  social: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm5 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM16.5 7.5h.01',
  gaming: 'M7 9h10a4 4 0 0 1 4 4v1.5a2.5 2.5 0 0 1-4.6 1.4L15 14H9l-1.4 1.9A2.5 2.5 0 0 1 3 14.5V13a4 4 0 0 1 4-4Zm1 2.5v3M6.5 13h3M15.5 12.5h.01M17.5 14h.01',
  'personal-brand': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  business: 'M4 20V8l8-4 8 4v12M9 20v-5h6v5M8 10h.01M12 10h.01M16 10h.01',
  creator: 'M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7Zm6.5 1.5v5l4-2.5-4-2.5ZM8 21h8',
  project: 'M5 19l4-4M14.5 4.5l5 5-7.5 7.5H7v-5l7.5-7.5ZM12 7l5 5',
};

export const TypeIcon = ({ type, ...p }: SVGProps<SVGSVGElement> & { type: string }) => (
  <svg {...base({ width: 22, height: 22, ...p })}>
    <path d={typeIconPaths[type]} />
  </svg>
);
