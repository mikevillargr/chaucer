# Design tokens

Extracted from the Android Gmail APK (v2026.10.19, `gm3_sys_color_*`, default config) with
`scripts/spec/resolve-colors.js`. These are Google Material 3 ("GM3") values used as a
visual reference; the app defines its own CSS variables from them in `src/styles/tokens.css`.

## Colour

| Token | Light | Dark |
| --- | --- | --- |
| background | #ffffff | #131314 |
| error | #b3261e | #f2b8b5 |
| error_container | #f9dedc | #8c1d18 |
| error_state_content | #601410 | #f2b8b5 |
| inverse_on_surface | #f2f2f2 | #303030 |
| inverse_primary | #a8c7fa | #0b57d0 |
| inverse_primary_state_content | #a8c7fa | #0842a0 |
| inverse_primary_state_layer | #7cacf8 | #0b57d0 |
| inverse_surface | #303030 | #e3e3e3 |
| on_background | #1f1f1f | #e3e3e3 |
| on_error | #ffffff | #601410 |
| on_error_container | #410e0b | #f9dedc |
| on_primary | #ffffff | #062e6f |
| on_primary_container | #041e49 | #d3e3fd |
| on_primary_state_layer | #041e49 |  |
| on_secondary | #ffffff | #003355 |
| on_secondary_container | #001d35 | #c2e7ff |
| on_secondary_state_layer | #001d35 |  |
| on_surface | #1f1f1f | #e3e3e3 |
| on_surface_state_content |  | #e3e3e3 |
| on_surface_variant | #444746 | #c4c7c5 |
| on_surface_variant_state_content |  | #c4c7c5 |
| on_tertiary | #ffffff | #0a3818 |
| on_tertiary_container | #072711 | #c4eed0 |
| outline | #747775 | #8e918f |
| outline_variant | #c4c7c5 | #444746 |
| primary | #0b57d0 | #a8c7fa |
| primary_container | #d3e3fd | #0842a0 |
| primary_state_content | #0842a0 |  |
| primary_state_layer |  | #7cacf8 |
| secondary | #00639b | #7fcfff |
| secondary_container | #c2e7ff | #004a77 |
| secondary_state_content | #004a77 |  |
| secondary_state_layer |  | #5ab3f0 |
| surface | #ffffff | #131314 |
| surface_bright | #ffffff | #37393b |
| surface_container | #f0f4f9 | #1e1f20 |
| surface_container_high | #e9eef6 | #282a2c |
| surface_container_highest | #dde3ea | #333537 |
| surface_container_low | #f8fafd | #1b1b1b |
| surface_container_lowest | #ffffff | #0e0e0e |
| surface_dim | #d3dbe5 | #131314 |
| surface_variant | #e1e3e1 | #444746 |
| tertiary | #146c2e | #6dd58c |
| tertiary_container | #c4eed0 | #0f5223 |

## Type
The Android app uses Google Sans (proprietary — not shipped). The Mac app uses the system
font stack (`-apple-system`, SF Pro) at these M3 roles:

| Role | Size / line | Weight | Used for |
| --- | --- | --- | --- |
| title-large | 22 / 28 | 400 | Thread subject in reader |
| title-medium | 16 / 24 | 500 | Pane headers |
| body-large | 16 / 24 | 400 | Message body |
| body-medium | 14 / 20 | 400 | Thread list snippet, sender (unread: 600) |
| label-large | 14 / 20 | 500 | Buttons, nav items |
| label-medium | 12 / 16 | 500 | Chips, timestamps |

## Shape and density
- Corner radius: 8 (chips), 12 (cards/menus), 16 (compose window), 28 (FAB/search bar).
- List density options from the app: **Default**, **Comfortable**, **Compact**
  (`density_option_*`) — row heights 72 / 64 / 48 px on desktop.
- Selected nav item: pill using `secondary_container` / `on_secondary_container`.

## Icons
Material Symbols Rounded (Apache 2.0). No Google product logos or Gmail icon are used.
