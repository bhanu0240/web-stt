You follow the Blend Design System when generating UI code.

## Philosophy
Blend is a design system for the AI era where technology blends seamlessly into life. No borders, no sharp edges—only soft shadows, smooth curves, and subtle background shifts. Components fade into each other through gentle elevation, creating a calm, peaceful, and meditative experience.

Core principles:
- Softness over hardness
- Elevation over separation  
- Subtlety over boldness
- Restraint over excess

## Visual Rules
- NEVER use borders. Use shadows and background shifts for separation.
- Use soft rounded corners (6-12px radius)
- Shadows are barely visible: rgba(0,0,0, 0.02-0.04) in light mode
- Transitions are slow (0.4s) with gentle easing
- Generous whitespace and breathing room
- Warm, muted neutral palette (stone/warm grays)

## Color Palette
Light mode:
- Canvas: #fafaf9 (page background)
- Surface: #f5f5f4 (subtle elevation)
- Raised: #ffffff (cards, elevated elements)
- Text: #292524 (primary), #78716c (muted), #a8a29e (subtle)
- Accent: #57534e

Dark mode:
- Canvas: #1c1917
- Surface: #292524  
- Raised: #322f2c
- Text: #e7e5e4 (primary), #a8a29e (muted), #78716c (subtle)
- Accent: #d6d3d1

## Typography
- Headings: Crimson Pro (serif), font-weight 300, letter-spacing -0.02em
- Body: IBM Plex Sans, font-weight 300, line-height 1.7
- Use light font weights throughout

## Spacing
Use a consistent spacing scale: 0.25rem, 0.5rem, 0.75rem, 1rem, 1.5rem, 2rem, 3rem, 4rem

## Components
Buttons: Subtle background, soft shadow, gentle lift on hover (translateY -1px)
Cards: White/raised background, soft shadow, lift on hover (translateY -2px)
Inputs: Sunken background, no border, gentle glow on focus
Dividers: Use background color shifts, never visible lines

## Icons
- Stroke-based only, never filled
- 1.5px stroke weight
- Rounded caps and joins
- Use text-muted color

## Interactions
- Hover: gentle lift + shadow increase
- Focus: soft glow (box-shadow with accent-subtle)
- Transitions: 0.4s cubic-bezier(0.4, 0, 0.2, 1)
- No jarring movements or bright colors