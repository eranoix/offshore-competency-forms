/**
 * One drawn set: stroked at 1.5, 24-box, currentColor, so they inherit whatever
 * the row is doing.
 */
const PATHS = {
  home: "M4 11.2 12 4l8 7.2M6.4 9.6V20h11.2V9.6",
  form: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  account: "M12 12a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2M5 20c.8-3.4 3.6-5 7-5s6.2 1.6 7 5",
  people: "M9.5 11.4a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2M3.4 19.4c.7-2.9 3.1-4.3 6.1-4.3s5.4 1.4 6.1 4.3M16.4 5.6a3 3 0 0 1 0 5.8M18.2 14.9c1.6.6 2.7 1.8 3.1 3.6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7.2V12l3.2 2",
  money: "M15.2 7.6H10.4a2.4 2.4 0 0 0 0 4.8h3.2a2.4 2.4 0 0 1 0 4.8H8.4M12 5.6v12.8",
  calendar: "M4.8 6.4h14.4v13.2H4.8zM4.8 10.8h14.4M9 4v3.6M15 4v3.6",
  badge: "M12 3.2 14.4 8l5.2.8-3.8 3.6.9 5.2-4.7-2.5-4.7 2.5.9-5.2L4.4 8.8 9.6 8z",
  power: "M12 4v8M7.6 7a7 7 0 1 0 8.8 0",
  print: "M7 9V4h10v5M7 18H5.6A1.6 1.6 0 0 1 4 16.4v-4.8A1.6 1.6 0 0 1 5.6 10h12.8a1.6 1.6 0 0 1 1.6 1.6v4.8a1.6 1.6 0 0 1-1.6 1.6H17M7 15h10v5H7z",
  download: "M12 4v10m0 0 4-4m-4 4-4-4M5 19h14",
  share: "M8.6 13.4a2.4 2.4 0 1 1 0-2.8m0 2.8 6.8 3.4m-6.8-6.2 6.8-3.4M17.6 7.6a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8m0 13.6a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8",
  upload: "M4 14.4V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.6M12 3.6v10.8m0-10.8L8.2 7.4M12 3.6l3.8 3.8",
  save: "M5 5h10l4 4v10H5zM8 5v5h7M9 19v-5h6v5",
  draft: "M4.8 12.6 12 5.4l6.6 6.6-7.2 7.2H4.8zM14.4 7.8l1.8-1.8a2.4 2.4 0 0 1 3.4 3.4l-1.8 1.8",
  check: "M5 12.5 9.5 17 19 7",
};

export default function Icon({ name, size = 18, className }) {
  const d = PATHS[name] || PATHS.form;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
