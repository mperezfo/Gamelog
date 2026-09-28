interface LogoProps {
  className?: string
}

/**
 * The app mark, inline so it can take `currentColor` and match the ink
 * color of whatever text sits next to it, in both themes.
 */
export function Logo({ className = 'size-4' }: LogoProps) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" className={className}>
      <g transform="translate(0.000000,1024.000000) scale(0.100000,-0.100000)" fill="currentColor" stroke="none">
        <path d="M1818 8949 c-17 -9 -18 -202 -18 -3827 0 -2956 3 -3821 12 -3830 9
-9 747 -12 3259 -12 1785 0 3274 3 3308 6 l61 7 -2 1811 -3 1811 -837 3 -838
2 -1 -137 c-1 -76 -3 -499 -5 -941 -2 -442 -6 -807 -9 -812 -4 -6 -574 -10
-1543 -11 -845 0 -1573 -4 -1617 -9 -64 -7 -83 -6 -95 6 -13 12 -14 275 -12
2107 2 1150 6 2094 10 2097 4 3 519 4 1145 2 1116 -3 1138 -3 1135 -22 -2 -10
-148 -168 -325 -350 l-323 -330 1 -1173 c0 -644 4 -1180 8 -1190 7 -19 -15
-41 736 722 176 179 370 375 431 436 60 60 330 334 600 609 269 274 599 610
734 746 135 137 349 355 475 485 127 130 254 259 283 287 l52 51 0 728 c0 654
-2 727 -16 733 -29 11 -6587 6 -6606 -5z"
        />
      </g>
    </svg>
  )
}
