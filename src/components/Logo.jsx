/**
 * The mark: a sheet with its corner turned down, the fold read as a 7, and a tick
 * where the signature would go. The wordmark is optional because the retracted
 * rail shows the mark alone.
 */
export function Mark({ size = 36, id = "offshore-report" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label="Offshore Report"
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="40" y2="40">
          <stop offset="0" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#6D4FD6" />
        </linearGradient>
        <linearGradient id={`${id}-sheet`} x1="10" y1="8" x2="30" y2="33">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E9E2FF" />
        </linearGradient>
      </defs>

      <rect width="40" height="40" rx="11.5" fill={`url(#${id}-bg)`} />

      {/* the sheet, corner turned down */}
      <path
        d="M13.4 8.5h8.8l5.4 5.6v15.4a2.6 2.6 0 0 1-2.6 2.6H13.4a2.6 2.6 0 0 1-2.6-2.6V11.1a2.6 2.6 0 0 1 2.6-2.6Z"
        fill={`url(#${id}-sheet)`}
      />
      {/* the fold, read as a 7 */}
      <path d="M22.2 8.5l5.4 5.6h-5.4V8.5Z" fill="#8B6FF0" opacity=".55" />
      <path
        d="M15.6 15.4h4.2M15.6 19.2h7"
        stroke="#8B6FF0"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity=".45"
      />
      {/* the tick, signed off */}
      <path
        d="M15.4 25.2l3.1 3.1 6.3-6.6"
        stroke="#6D4FD6"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Logo({ size = 36, id }) {
  return (
    <span className="logo-lockup">
      <Mark size={size} id={id} />
      <span className="wordmark">
        form<b>flow</b>
      </span>
    </span>
  );
}
