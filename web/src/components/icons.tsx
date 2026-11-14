import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 16, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...rest,
});

export const IconCheck = (p: P) => (
  <svg {...base(p)} strokeWidth={2.6}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/** A checkmark that draws itself in. */
export const IconCheckDraw = (p: P) => (
  <svg {...base(p)} strokeWidth={2.8}>
    <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} strokeDasharray="1 1" className="animate-draw" />
  </svg>
);

export const IconX = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const IconExternal = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 5h5v5M19 5l-8 8M11 7H7a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-4" />
  </svg>
);

export const IconShield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.600-7-5.200-7-9.500V6z" />
    <path d="M9 12l2.200 2.200L15.200 10" />
  </svg>
);

export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="9" rx="2.5" />
    <path d="M8 11V8a4 4 0 018 0v3" />
  </svg>
);

export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.500V12l3 2" />
  </svg>
);

export const IconWallet = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7.500A2.500 2.500 0 016.500 5H17v3" />
    <rect x="4" y="8" width="16" height="11" rx="2.500" />
    <path d="M16 13.500h.01" />
  </svg>
);

export const IconComment = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1h-7l-4.500 3.500V16H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
  </svg>
);

export const IconCommit = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.500" />
    <path d="M3 12h5.500M15.500 12H21" />
  </svg>
);

export const IconPullRequest = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6.500" cy="6" r="2.200" />
    <circle cx="6.500" cy="18" r="2.200" />
    <circle cx="17.500" cy="18" r="2.200" />
    <path d="M6.500 8.200v7.600M17.500 15.800V10a3 3 0 00-3-3h-2.500M13.500 4.500L11.500 7l2 2.500" />
  </svg>
);

export const IconAlert = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4l9 15.500H3z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
);

export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.500" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M19.500 12a7.500 7.500 0 11-2.200-5.300M19.500 4.500v4h-4" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconStream = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h10M4 12h16M4 17h7" />
    <circle cx="18" cy="7" r="1.500" />
    <circle cx="15" cy="17" r="1.500" />
  </svg>
);

export const IconGithub = ({ size = 16, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M12 2a10 10 0 00-3.160 19.490c.5.090.680-.220.680-.480v-1.700c-2.780.600-3.370-1.340-3.370-1.340-.450-1.160-1.110-1.470-1.110-1.470-.910-.620.070-.610.070-.610 1 .070 1.530 1.030 1.530 1.030.890 1.530 2.340 1.090 2.910.830.090-.650.350-1.090.630-1.340-2.220-.250-4.560-1.110-4.560-4.940 0-1.090.390-1.980 1.030-2.680-.100-.250-.450-1.270.100-2.650 0 0 .840-.270 2.750 1.020a9.560 9.560 0 015 0c1.910-1.290 2.750-1.020 2.750-1.020.550 1.380.200 2.400.100 2.650.640.700 1.030 1.590 1.030 2.680 0 3.840-2.340 4.680-4.570 4.930.360.310.680.920.680 1.850v2.750c0 .270.180.580.690.480A10 10 0 0012 2z" />
  </svg>
);
