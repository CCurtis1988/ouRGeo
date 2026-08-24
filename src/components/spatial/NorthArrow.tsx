import React from 'react'
import { useSpatialStore } from '@/store/spatial'
import type { NorthArrowStyle, NorthArrowSettings } from '@/store/spatial'

function overlayStyle(
  position: NorthArrowSettings['position'],
  offsetX: number,
  offsetY: number,
): React.CSSProperties {
  return {
    position: 'absolute',
    zIndex: 10,
    ...(position.includes('top') ? { top: offsetY } : { bottom: offsetY }),
    ...(position.includes('left') ? { left: offsetX } : { right: offsetX }),
  }
}

function renderArrowBody(
  style: NorthArrowStyle,
  primary: string,
  secondary: string,
): React.ReactElement {
  switch (style) {
    case 'split':
      return (
        <>
          <polygon points="12,3 19,30 12,23" fill={primary} />
          <polygon points="12,3 5,30 12,23" fill={secondary} />
          <polygon
            points="12,3 19,30 12,23 5,30"
            fill="none"
            stroke={secondary}
            strokeWidth="0.75"
            strokeLinejoin="round"
          />
        </>
      )
    case 'simple':
      return <polygon points="12,3 19,30 12,22 5,30" fill={secondary} />
    case 'open':
      return (
        <>
          <polygon
            points="12,3 19,30 12,22 5,30"
            fill="none"
            stroke={secondary}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <line x1="12" y1="3" x2="12" y2="22" stroke={secondary} strokeWidth="0.75" />
        </>
      )
    case 'dot':
      return (
        <>
          <polygon points="12,2 18,22 12,17 6,22" fill={secondary} />
          <circle cx="12" cy="26" r="4" fill="none" stroke={secondary} strokeWidth="1.5" />
          <circle cx="12" cy="26" r="1.5" fill={secondary} />
        </>
      )
    case 'compass':
      return (
        <>
          {/* N arm — longer, primary colored */}
          <polygon points="12,2 14,18 12,14 10,18" fill={primary} />
          {/* S arm */}
          <polygon points="12,32 14,16 12,20 10,16" fill={secondary} />
          {/* E arm */}
          <polygon points="22,17 14,15 16,17 14,19" fill={secondary} />
          {/* W arm */}
          <polygon points="2,17 10,15 8,17 10,19" fill={secondary} />
          {/* Center */}
          <circle cx="12" cy="17" r="1.5" fill={secondary} />
        </>
      )
  }
}

export function NorthArrow(): React.ReactElement {
  const s = useSpatialStore((state) => state.northArrowSettings)
  const arrowHeight = Math.round(s.size * (44 / 24))

  return (
    <div
      style={{
        ...overlayStyle(s.position, s.offsetX, s.offsetY),
        opacity: s.opacity,
      }}
      className="pointer-events-none select-none"
      title="North"
    >
      <svg
        viewBox="0 0 24 44"
        width={s.size}
        height={arrowHeight}
        xmlns="http://www.w3.org/2000/svg"
      >
        {renderArrowBody(s.style, s.primaryColor, s.secondaryColor)}
        {s.showLabel && (
          <text
            x="12"
            y="42"
            textAnchor="middle"
            fontSize={s.labelSize}
            fontWeight="600"
            fontFamily="system-ui, sans-serif"
            fill={s.labelColor}
          >
            N
          </text>
        )}
      </svg>
    </div>
  )
}
