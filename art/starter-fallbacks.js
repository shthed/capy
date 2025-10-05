(function () {
  const fallbackSvgs = {
    "starter-capybara-forest": String.raw`<?xml version="1.0" ?>
<!-- Capybara in the Forest - Segmented SVG -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600" width="960" height="600" role="img" aria-labelledby="title desc">
  <title id="title">Capybara in a Forest</title>
  <desc id="desc">A detailed capybara beside a pond with layered pines, hills, ripples, and shaded fur.</desc>

  <defs>
    <linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#86c5ff"/>
      <stop offset="70%" stop-color="#e6f0ff"/>
      <stop offset="100%" stop-color="#fef6e4"/>
    </linearGradient>
    <linearGradient id="gSun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFD36E"/>
      <stop offset="100%" stop-color="#FFB347"/>
    </linearGradient>
    <linearGradient id="gWater" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7fd5ef"/>
      <stop offset="100%" stop-color="#2a94b6"/>
    </linearGradient>
    <linearGradient id="gGround" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6fb06f"/>
      <stop offset="100%" stop-color="#3b7b46"/>
    </linearGradient>
    <linearGradient id="gFurBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8e5b3a"/>
      <stop offset="55%" stop-color="#956141"/>
      <stop offset="100%" stop-color="#5a3d2a"/>
    </linearGradient>
    <linearGradient id="gFurHead" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8e5b3a"/>
      <stop offset="100%" stop-color="#6b452e"/>
    </linearGradient>
    <filter id="fSoft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.25"/>
    </filter>
    <filter id="fBlurSmall" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.5"/>
    </filter>
    <radialGradient id="gVig" cx="50%" cy="45%" r="70%">
      <stop offset="60%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.25"/>
    </radialGradient>
  </defs>

  <g id="region-c01" data-cell-id="c1" data-color-id="1" data-color-name="Sky Haze" data-color-hex="#86c5ff">
    <title>Region c1 – Color #1 (Sky Haze)</title>
    <path d="M0 0 H960 V300 H0 Z" fill="url(#gSky)"/>
  </g>

  <g id="region-c02" data-cell-id="c2" data-color-id="2" data-color-name="Sun Glow" data-color-hex="#ffb347">
    <title>Region c2 – Color #2 (Sun Glow)</title>
    <path d="M734 110 A56 56 0 1 1 846 110 A56 56 0 1 1 734 110 Z" fill="url(#gSun)" filter="url(#fSoft)"/>
  </g>

  <g id="region-c03" data-cell-id="c3" data-color-id="3" data-color-name="Distant Ridge" data-color-hex="#b7d1a7">
    <title>Region c3 – Color #3 (Distant Ridge)</title>
    <path d="M0 360 C120 300 200 330 310 320 C420 310 520 350 640 330 C760 310 860 320 960 300 L960 470 L0 470 Z" fill="#b7d1a7"/>
  </g>

  <g id="region-c04" data-cell-id="c4" data-color-id="4" data-color-name="Mid Ridge" data-color-hex="#9dc692">
    <title>Region c4 – Color #4 (Mid Ridge)</title>
    <path d="M0 400 C140 350 260 380 380 370 C520 360 680 400 820 380 C900 370 930 370 960 360 L960 500 L0 500 Z" fill="#9dc692"/>
  </g>

  <g id="region-c05" data-cell-id="c5" data-color-id="5" data-color-name="Left Pine Ridge" data-color-hex="#2f7a33">
    <title>Region c5 – Color #5 (Left Pine Ridge)</title>
    <path d="M0 500 L20 320 L60 360 L100 270 L140 350 L180 280 L220 360 L260 290 L300 380 L330 300 L360 500 Z" fill="#2f7a33"/>
  </g>

  <g id="region-c06" data-cell-id="c6" data-color-id="6" data-color-name="Center Pine Ridge" data-color-hex="#2a6f2d">
    <title>Region c6 – Color #6 (Center Pine Ridge)</title>
    <path d="M360 500 L380 300 L420 360 L460 280 L500 360 L540 290 L580 370 L620 300 L660 390 L700 310 L730 500 Z" fill="#2a6f2d"/>
  </g>

  <g id="region-c07" data-cell-id="c7" data-color-id="7" data-color-name="Right Pine Ridge" data-color-hex="#255f27">
    <title>Region c7 – Color #7 (Right Pine Ridge)</title>
    <path d="M730 500 L750 310 L790 360 L830 280 L870 350 L910 290 L950 360 L960 310 L960 500 Z" fill="#255f27"/>
  </g>

  <g id="region-c08" data-cell-id="c8" data-color-id="8" data-color-name="Lake Surface" data-color-hex="#7fd5ef">
    <title>Region c8 – Color #8 (Lake Surface)</title>
    <path d="M0 470 C180 450 360 520 540 500 C720 480 840 520 960 505 L960 600 L0 600 Z" fill="url(#gWater)"/>
  </g>

  <g id="region-c09" data-cell-id="c9" data-color-id="9" data-color-name="Lake Highlight" data-color-hex="#cfeef6">
    <title>Region c9 – Color #9 (Lake Highlight)</title>
    <path d="M20 500 C200 485 360 515 540 498 C720 482 840 515 940 505 L940 520 C840 530 720 512 540 524 C360 536 200 514 20 526 Z" fill="#cfeef6" opacity="0.6"/>
  </g>

  <g id="region-c10" data-cell-id="c10" data-color-id="10" data-color-name="Shoreline Meadow" data-color-hex="#3b7b46">
    <title>Region c10 – Color #10 (Shoreline Meadow)</title>
    <path d="M0 520 C120 530 240 540 360 535 C480 530 600 540 720 535 C840 530 900 535 960 540 L960 600 L0 600 Z" fill="url(#gGround)"/>
  </g>

  <g id="region-c11" data-cell-id="c11" data-color-id="11" data-color-name="Capy Body" data-color-hex="#8e5b3a" transform="translate(300,350)">
    <title>Region c11 – Color #11 (Capy Body)</title>
    <path d="M70 160 C 60 140, 58 115, 72 95 C 88 73, 116 58, 150 52 C 210 42, 300 55, 350 92 C 385 118, 400 148, 396 170 C 392 192, 374 206, 346 210 L 150 215 C 116 216, 84 194, 76 175 C 72 167, 71 163, 70 160 Z" fill="url(#gFurBody)" stroke="#4b3325" stroke-opacity="0.25"/>
  </g>

  <g id="region-c12" data-cell-id="c12" data-color-id="12" data-color-name="Capy Head" data-color-hex="#6b452e" transform="translate(300,350)">
    <title>Region c12 – Color #12 (Capy Head)</title>
    <path d="M78 140 C 66 120, 70 98, 92 86 C 118 72, 150 74, 182 94 C 198 104, 210 118, 210 130 C 210 148, 194 162, 173 168 C 148 175, 112 169, 94 158 C 86 153, 81 148, 78 140 Z" fill="url(#gFurHead)"/>
  </g>

  <g id="region-c13" data-cell-id="c13" data-color-id="13" data-color-name="Outer Ear" data-color-hex="#6e4930" transform="translate(300,350)">
    <title>Region c13 – Color #13 (Outer Ear)</title>
    <path d="M148 98 A12 9 0 1 0 172 98 A12 9 0 1 0 148 98 Z" fill="#6e4930"/>
  </g>

  <g id="region-c14" data-cell-id="c14" data-color-id="14" data-color-name="Inner Ear" data-color-hex="#8c5e3e" transform="translate(300,350)">
    <title>Region c14 – Color #14 (Inner Ear)</title>
    <path d="M153 98 A7 5 0 1 0 167 98 A7 5 0 1 0 153 98 Z" fill="#8c5e3e"/>
  </g>

  <g id="region-c15" data-cell-id="c15" data-color-id="15" data-color-name="Capy Eye" data-color-hex="#232222" transform="translate(300,350)">
    <title>Region c15 – Color #15 (Capy Eye)</title>
    <path d="M136 132 A6 6 0 1 0 148 132 A6 6 0 1 0 136 132 Z" fill="#232222"/>
  </g>

  <g id="region-c16" data-cell-id="c16" data-color-id="16" data-color-name="Eye Highlight" data-color-hex="#ffffff" transform="translate(300,350)">
    <title>Region c16 – Color #16 (Eye Highlight)</title>
    <path d="M141.8 130 A2.2 2.2 0 1 0 146.2 130 A2.2 2.2 0 1 0 141.8 130 Z" fill="#ffffff"/>
  </g>

  <g id="region-c17" data-cell-id="c17" data-color-id="17" data-color-name="Snout Shadow" data-color-hex="#3a2a1f" transform="translate(300,350)">
    <title>Region c17 – Color #17 (Snout Shadow)</title>
    <path d="M181 144 A7 4.5 0 1 0 195 144 A7 4.5 0 1 0 181 144 Z" fill="#3a2a1f" opacity="0.7"/>
  </g>

  <g id="region-c18" data-cell-id="c18" data-color-id="18" data-color-name="Capy Legs" data-color-hex="#6f4b32" transform="translate(300,350)">
    <title>Region c18 – Color #18 (Capy Legs)</title>
    <path d="M140 210 C138 224, 136 240, 140 246 C152 256, 170 256, 178 246 C182 240, 180 224, 178 212 Z" fill="#6f4b32"/>
    <path d="M118 208 C116 222, 114 238, 118 244 C128 254, 146 254, 154 244 C158 238, 156 222, 154 210 Z" fill="#6f4b32" opacity="0.85"/>
    <path d="M280 206 C278 220, 276 236, 280 242 C292 252, 312 252, 322 242 C326 236, 324 220, 322 208 Z" fill="#6f4b32"/>
    <path d="M300 204 C298 218, 296 234, 300 240 C312 250, 332 250, 342 240 C346 234, 344 218, 342 206 Z" fill="#6f4b32" opacity="0.85"/>
  </g>

  <g id="region-c19" data-cell-id="c19" data-color-id="19" data-color-name="Cast Shadow" data-color-hex="#000000" transform="translate(300,350)">
    <title>Region c19 – Color #19 (Cast Shadow)</title>
    <path d="M100 232 A120 18 0 1 0 340 232 A120 18 0 1 0 100 232 Z" fill="#000000" opacity="0.18" filter="url(#fBlurSmall)"/>
  </g>

  <g id="region-c20" data-cell-id="c20" data-color-id="20" data-color-name="Forefoot Shadow" data-color-hex="#000000" transform="translate(300,350)">
    <title>Region c20 – Color #20 (Forefoot Shadow)</title>
    <path d="M154 256 A16 4 0 1 0 186 256 A16 4 0 1 0 154 256 Z" fill="#000000" opacity="0.25" filter="url(#fBlurSmall)"/>
    <path d="M132 254 A16 4 0 1 0 164 254 A16 4 0 1 0 132 254 Z" fill="#000000" opacity="0.22" filter="url(#fBlurSmall)"/>
  </g>

  <g id="region-c21" data-cell-id="c21" data-color-id="21" data-color-name="Hindfoot Shadow" data-color-hex="#000000" transform="translate(300,350)">
    <title>Region c21 – Color #21 (Hindfoot Shadow)</title>
    <path d="M296 252 A16 4 0 1 0 328 252 A16 4 0 1 0 296 252 Z" fill="#000000" opacity="0.25" filter="url(#fBlurSmall)"/>
    <path d="M316 250 A16 4 0 1 0 348 250 A16 4 0 1 0 316 250 Z" fill="#000000" opacity="0.22" filter="url(#fBlurSmall)"/>
  </g>

  <g id="region-c22" data-cell-id="c22" data-color-id="22" data-color-name="Lakeside Greens" data-color-hex="#2c6e49">
    <title>Region c22 – Color #22 (Lakeside Greens)</title>
    <path d="M110 560 q20 -40 40 0 q-25 -50 -5 -85 q-10 30 10 60 q-10 -30 30 -55 q-30 45 -5 80 Z" fill="#2c6e49" opacity="0.95"/>
    <path d="M860 560 q18 -36 36 0 q-22 -44 -4 -76 q-10 26 8 52 q-8 -26 28 -48 q-28 40 -6 72 Z" fill="#2c6e49" opacity="0.95"/>
  </g>

  <g id="region-c23" data-cell-id="c23" data-color-id="23" data-color-name="Pond Reeds" data-color-hex="#2a6f2d">
    <title>Region c23 – Color #23 (Pond Reeds)</title>
    <path d="M450 560 q4 -18 12 0 q-6 -20 -2 -34 q-3 12 4 24 q-4 -12 14 -22 q-12 16 -4 30 Z" fill="#2a6f2d"/>
    <path d="M500 558 q4 -16 10 0 q-6 -18 -2 -30 q-2 10 4 20 q-4 -10 12 -18 q-10 14 -4 26 Z" fill="#2a6f2d"/>
  </g>

  <path d="M0 0 H960 V600 H0 Z" fill="url(#gVig)" style="mix-blend-mode:multiply"/>
</svg>
`,
    "starter-capybara-lagoon": String.raw`<!-- Capybara Lagoon Sunrise - Segmented SVG -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600" width="960" height="600" role="img" aria-labelledby="title desc">
  <title id="title">Capybara Lagoon Sunrise</title>
  <desc id="desc">Layered sunrise bands over a lagoon with a stylized capybara on the shore.</desc>
  <g id="region-c01" data-cell-id="c1" data-color-id="1" data-color-name="Sunrise Sky" data-color-hex="#f6bf60">
    <title>Region c1 – Color #1 (Sunrise Sky)</title>
    <path d="M0 0 L960 0 L960 80 C 820 70 680 68 540 72 C 380 78 220 86 0 80 Z"/>
  </g>
  <g id="region-c02" data-cell-id="c2" data-color-id="1" data-color-name="Sunrise Sky" data-color-hex="#f6bf60">
    <title>Region c2 – Color #1 (Sunrise Sky)</title>
    <path d="M0 80 C 200 90 360 86 540 80 C 720 74 860 76 960 80 L960 148 C 820 142 680 148 520 156 C 360 166 200 164 0 148 Z"/>
  </g>
  <g id="region-c03" data-cell-id="c3" data-color-id="2" data-color-name="Amber Drift" data-color-hex="#f4994c">
    <title>Region c3 – Color #2 (Amber Drift)</title>
    <path d="M0 148 C 160 156 320 160 520 152 C 500 176 480 198 440 212 C 320 220 160 218 0 216 Z"/>
  </g>
  <g id="region-c04" data-cell-id="c4" data-color-id="2" data-color-name="Amber Drift" data-color-hex="#f4994c">
    <title>Region c4 – Color #2 (Amber Drift)</title>
    <path d="M520 152 C 700 150 840 146 960 148 C 940 176 900 198 860 210 C 740 220 640 220 520 214 C 520 194 520 172 520 152 Z"/>
  </g>
  <g id="region-c05" data-cell-id="c5" data-color-id="3" data-color-name="Violet Ridge" data-color-hex="#9a6bb3">
    <title>Region c5 – Color #3 (Violet Ridge)</title>
    <path d="M0 216 C 120 228 220 232 320 230 C 300 248 260 268 210 278 C 150 286 80 284 0 280 Z"/>
  </g>
  <g id="region-c06" data-cell-id="c6" data-color-id="3" data-color-name="Violet Ridge" data-color-hex="#9a6bb3">
    <title>Region c6 – Color #3 (Violet Ridge)</title>
    <path d="M320 230 C 440 236 520 234 640 226 C 630 250 600 268 560 276 C 480 286 400 284 320 278 C 320 258 320 244 320 230 Z"/>
  </g>
  <g id="region-c07" data-cell-id="c7" data-color-id="3" data-color-name="Violet Ridge" data-color-hex="#9a6bb3">
    <title>Region c7 – Color #3 (Violet Ridge)</title>
    <path d="M640 226 C 760 224 860 220 960 220 C 940 240 900 260 860 272 C 780 286 700 284 640 278 C 640 256 640 240 640 226 Z"/>
  </g>
  <g id="region-c08" data-cell-id="c8" data-color-id="4" data-color-name="Forest Ridge" data-color-hex="#5d7a76">
    <title>Region c8 – Color #4 (Forest Ridge)</title>
    <path d="M0 280 C 100 292 200 300 320 292 C 300 312 260 328 210 336 C 150 344 80 344 0 340 Z"/>
  </g>
  <g id="region-c09" data-cell-id="c9" data-color-id="4" data-color-name="Forest Ridge" data-color-hex="#5d7a76">
    <title>Region c9 – Color #4 (Forest Ridge)</title>
    <path d="M320 292 C 440 298 540 300 640 298 C 620 318 580 332 540 340 C 460 348 380 346 320 340 C 320 320 320 306 320 292 Z"/>
  </g>
  <g id="region-c10" data-cell-id="c10" data-color-id="4" data-color-name="Forest Ridge" data-color-hex="#5d7a76">
    <title>Region c10 – Color #4 (Forest Ridge)</title>
    <path d="M640 298 C 760 300 860 300 960 300 C 940 320 900 332 860 340 C 780 348 700 348 640 340 C 640 320 640 308 640 298 Z"/>
  </g>
  <g id="region-c11" data-cell-id="c11" data-color-id="5" data-color-name="Lagoon Light" data-color-hex="#76c7d6">
    <title>Region c11 – Color #5 (Lagoon Light)</title>
    <path d="M0 340 C 120 344 220 346 320 344 C 300 350 300 352 320 352 C 200 356 120 354 0 352 C 0 348 0 344 0 340 Z"/>
  </g>
  <g id="region-c12" data-cell-id="c12" data-color-id="5" data-color-name="Lagoon Light" data-color-hex="#76c7d6">
    <title>Region c12 – Color #5 (Lagoon Light)</title>
    <path d="M320 344 C 440 346 540 344 640 342 C 640 346 640 350 640 352 C 520 356 420 356 320 352 C 320 348 320 346 320 344 Z"/>
  </g>
  <g id="region-c13" data-cell-id="c13" data-color-id="5" data-color-name="Lagoon Light" data-color-hex="#76c7d6">
    <title>Region c13 – Color #5 (Lagoon Light)</title>
    <path d="M640 342 C 760 340 860 338 960 340 C 960 344 960 348 960 352 C 840 354 740 354 640 352 C 640 348 640 344 640 342 Z"/>
  </g>
  <g id="region-c14" data-cell-id="c14" data-color-id="5" data-color-name="Lagoon Light" data-color-hex="#76c7d6">
    <title>Region c14 – Color #5 (Lagoon Light)</title>
    <path d="M0 352 C 120 356 220 356 320 352 C 310 364 310 372 320 376 C 200 382 120 380 0 376 C 0 364 0 358 0 352 Z"/>
  </g>
  <g id="region-c15" data-cell-id="c15" data-color-id="5" data-color-name="Lagoon Light" data-color-hex="#76c7d6">
    <title>Region c15 – Color #5 (Lagoon Light)</title>
    <path d="M320 352 C 440 354 540 352 640 352 C 650 362 650 370 640 376 C 520 382 420 382 320 376 C 320 366 320 360 320 352 Z"/>
  </g>
  <g id="region-c16" data-cell-id="c16" data-color-id="5" data-color-name="Lagoon Light" data-color-hex="#76c7d6">
    <title>Region c16 – Color #5 (Lagoon Light)</title>
    <path d="M640 352 C 760 352 860 350 960 352 C 960 362 960 372 960 376 C 840 380 740 380 640 376 C 640 366 640 358 640 352 Z"/>
  </g>
  <g id="region-c17" data-cell-id="c17" data-color-id="6" data-color-name="Lagoon Depth" data-color-hex="#1c6f8c">
    <title>Region c17 – Color #6 (Lagoon Depth)</title>
    <path d="M0 376 C 160 382 320 388 480 384 C 480 394 480 400 480 404 C 320 408 160 404 0 404 C 0 392 0 384 0 376 Z"/>
  </g>
  <g id="region-c18" data-cell-id="c18" data-color-id="6" data-color-name="Lagoon Depth" data-color-hex="#1c6f8c">
    <title>Region c18 – Color #6 (Lagoon Depth)</title>
    <path d="M480 376 C 640 382 800 380 960 376 L960 404 C 800 410 640 412 480 404 C 480 394 480 386 480 376 Z"/>
  </g>
  <g id="region-c19" data-cell-id="c19" data-color-id="6" data-color-name="Lagoon Depth" data-color-hex="#1c6f8c">
    <title>Region c19 – Color #6 (Lagoon Depth)</title>
    <path d="M0 404 C 160 410 320 416 480 412 C 480 428 480 440 480 448 C 320 456 160 452 0 448 C 0 430 0 416 0 404 Z"/>
  </g>
  <g id="region-c20" data-cell-id="c20" data-color-id="6" data-color-name="Lagoon Depth" data-color-hex="#1c6f8c">
    <title>Region c20 – Color #6 (Lagoon Depth)</title>
    <path d="M480 412 C 640 416 800 410 960 404 L960 448 C 820 456 680 460 520 456 C 500 454 490 448 480 448 C 480 432 480 420 480 412 Z"/>
  </g>
  <g id="region-c21" data-cell-id="c21" data-color-id="7" data-color-name="Shore Left" data-color-hex="#4f7d5c">
    <title>Region c21 – Color #7 (Shore Left)</title>
    <path d="M0 448 C 120 454 220 458 300 462 C 280 500 220 540 140 566 C 80 584 30 592 0 592 C 0 544 0 496 0 448 Z"/>
  </g>
  <g id="region-c22" data-cell-id="c22" data-color-id="7" data-color-name="Shore Left" data-color-hex="#4f7d5c">
    <title>Region c22 – Color #7 (Shore Left)</title>
    <path d="M300 462 C 360 468 420 472 520 456 C 510 486 490 514 460 540 C 420 568 360 580 300 572 C 280 540 290 500 300 462 Z"/>
  </g>
  <g id="region-c23" data-cell-id="c23" data-color-id="8" data-color-name="Shore Middle" data-color-hex="#6b9358">
    <title>Region c23 – Color #8 (Shore Middle)</title>
    <path d="M520 456 C 640 462 720 464 780 460 C 788 474 792 498 796 528 C 786 580 768 584 752 588 C 700 600 656 598 604 588 C 566 580 534 564 518 546 C 506 532 506 520 520 510 C 508 496 512 476 520 456 Z"/>
  </g>
  <g id="region-c24" data-cell-id="c24" data-color-id="9" data-color-name="Capy Body" data-color-hex="#7d5735">
    <title>Region c24 – Color #9 (Capy Body)</title>
    <path d="M520 510 C 548 470 612 440 692 434 C 744 430 768 438 780 456 C 790 474 794 498 796 528 C 798 556 786 580 752 588 C 708 600 656 598 604 588 C 566 580 534 564 518 546 C 508 532 506 518 520 510 Z"/>
  </g>
  <g id="region-c25" data-cell-id="c25" data-color-id="10" data-color-name="Capy Head" data-color-hex="#5e3b24">
    <title>Region c25 – Color #10 (Capy Head)</title>
    <path d="M780 456 C 804 438 838 438 866 460 C 894 482 904 520 892 556 C 878 594 846 608 810 600 C 800 598 796 590 796 528 C 794 500 788 474 780 456 Z"/>
  </g>
  <g id="region-c26" data-cell-id="c26" data-color-id="11" data-color-name="Shore Right" data-color-hex="#3f5b3b">
    <title>Region c26 – Color #11 (Shore Right)</title>
    <path d="M780 460 C 840 456 900 454 960 452 L960 600 C 910 600 870 598 810 600 C 846 608 878 594 892 556 C 884 520 860 488 780 460 Z"/>
  </g>
</svg>
`,
    "starter-twilight-marsh": String.raw`<!-- Twilight Marsh Study - Segmented SVG -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600" width="960" height="600" role="img" aria-labelledby="title desc">
  <title id="title">Twilight Marsh Study</title>
  <desc id="desc">Bands of twilight sky over a reflective marsh with silhouetted capybaras along the shore.</desc>
  <g id="region-c01" data-cell-id="c1" data-color-id="1" data-color-name="Evening Sky" data-color-hex="#f7c59f">
    <title>Region c1 – Color #1 (Evening Sky)</title>
    <path d="M0 0 L960 0 L960 160 C 640 150 320 150 0 160 Z" />
  </g>
  <g id="region-c02" data-cell-id="c2" data-color-id="2" data-color-name="Glow Band" data-color-hex="#f27d72">
    <title>Region c2 – Color #2 (Glow Band)</title>
    <path d="M0 160 C 160 180 320 180 480 185 C 640 190 800 180 960 170 L960 230 C 640 240 320 240 0 230 Z" />
  </g>
  <g id="region-c03" data-cell-id="c3" data-color-id="3" data-color-name="Distant Ridge" data-color-hex="#8c5fa6">
    <title>Region c3 – Color #3 (Distant Ridge)</title>
    <path d="M0 230 C 200 260 400 250 600 270 C 800 290 880 270 960 280 L960 340 L0 340 Z" />
  </g>
  <g id="region-c04" data-cell-id="c4" data-color-id="4" data-color-name="Low Ridge" data-color-hex="#546d7a">
    <title>Region c4 – Color #4 (Low Ridge)</title>
    <path d="M0 340 C 200 360 400 360 600 355 C 800 350 880 350 960 355 L960 420 L0 420 Z" />
  </g>
  <g id="region-c05" data-cell-id="c5" data-color-id="5" data-color-name="River Mirror" data-color-hex="#4f9fc6">
    <title>Region c5 – Color #5 (River Mirror)</title>
    <path d="M0 420 C 220 440 440 450 660 440 C 800 434 880 430 960 432 L960 490 L0 490 Z" />
  </g>
  <g id="region-c06" data-cell-id="c6" data-color-id="6" data-color-name="River Depth" data-color-hex="#1f6b8f">
    <title>Region c6 – Color #6 (River Depth)</title>
    <path d="M0 490 C 200 510 400 520 600 515 C 800 510 880 508 960 510 L960 555 L0 555 Z" />
  </g>
  <g id="region-c07" data-cell-id="c7" data-color-id="7" data-color-name="Shore Glow" data-color-hex="#5d8f63">
    <title>Region c7 – Color #7 (Shore Glow)</title>
    <path d="M0 555 C 180 570 360 580 540 575 L540 600 L0 600 Z" />
  </g>
  <g id="region-c08" data-cell-id="c8" data-color-id="8" data-color-name="Shore Shadow" data-color-hex="#2f4c45">
    <title>Region c8 – Color #8 (Shore Shadow)</title>
    <path d="M540 575 C 700 570 840 565 960 570 L960 600 L540 600 Z" />
  </g>
</svg>
`,
    "starter-lush-forest": String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600" width="960" height="600" role="img" aria-labelledby="title desc">
  <title id="title">Lush Green Forest Walk</title>
  <desc id="desc">Layered forest scene with tall trunks framing a winding path through a sunlit clearing.</desc>
  <g id="region-c01" data-cell-id="c1" data-color-id="11" data-color-name="Sky Mist" data-color-hex="#d7e9f8">
    <title>Region c1 – Color #11 (Sky Mist)</title>
    <path d="M0 0 H960 V150 Q 870 120 760 132 Q 660 144 560 134 Q 460 124 360 136 Q 240 148 140 134 Q 60 122 0 140 Z"/>
  </g>
  <g id="region-c02" data-cell-id="c2" data-color-id="3" data-color-name="Leaf Light" data-color-hex="#b6e480">
    <title>Region c2 – Color #3 (Leaf Light)</title>
    <path d="M0 140 Q 90 110 200 126 Q 280 138 320 160 L320 220 Q 220 210 150 208 Q 70 206 0 200 Z"/>
  </g>
  <g id="region-c03" data-cell-id="c3" data-color-id="3" data-color-name="Leaf Light" data-color-hex="#b6e480">
    <title>Region c3 – Color #3 (Leaf Light)</title>
    <path d="M320 160 Q 420 136 520 136 Q 620 136 660 158 L660 220 Q 560 210 470 212 Q 380 214 320 220 Z"/>
  </g>
  <g id="region-c04" data-cell-id="c4" data-color-id="3" data-color-name="Leaf Light" data-color-hex="#b6e480">
    <title>Region c4 – Color #3 (Leaf Light)</title>
    <path d="M660 158 Q 760 136 850 126 Q 930 118 960 140 L960 220 Q 860 210 780 208 Q 700 206 660 220 Z"/>
  </g>
  <g id="region-c05" data-cell-id="c5" data-color-id="1" data-color-name="Forest Deep" data-color-hex="#1f3f2c">
    <title>Region c5 – Color #1 (Forest Deep)</title>
    <path fill-rule="evenodd" d="M0 200 C 160 220 320 230 480 232 C 640 234 800 226 960 214 L960 320 C 820 338 680 346 540 342 C 380 338 220 328 0 308 Z M96 200 L176 200 L176 360 L96 360 Z M408 200 L488 200 L488 360 L408 360 Z M704 200 L784 200 L784 360 L704 360 Z"/>
  </g>
  <g id="region-c06" data-cell-id="c6" data-color-id="4" data-color-name="Leaf Mid" data-color-hex="#7fca63">
    <title>Region c6 – Color #4 (Leaf Mid)</title>
    <path fill-rule="evenodd" d="M0 308 C 140 326 280 336 420 340 C 460 342 480 340 520 334 L520 400 C 420 410 320 420 220 418 C 140 416 60 408 0 400 Z M96 300 L176 300 L176 420 L96 420 Z M408 300 L488 300 L488 420 L408 420 Z"/>
  </g>
  <g id="region-c07" data-cell-id="c7" data-color-id="4" data-color-name="Leaf Mid" data-color-hex="#7fca63">
    <title>Region c7 – Color #4 (Leaf Mid)</title>
    <path fill-rule="evenodd" d="M520 334 C 640 326 760 318 880 314 C 920 312 940 314 960 316 L960 400 C 840 412 720 420 600 416 C 540 414 500 410 460 404 L460 340 Z M704 300 L784 300 L784 420 L704 420 Z M408 300 L488 300 L488 420 L408 420 Z"/>
  </g>
  <g id="region-c08" data-cell-id="c8" data-color-id="10" data-color-name="Canopy Shadow" data-color-hex="#2f4d30">
    <title>Region c8 – Color #10 (Canopy Shadow)</title>
    <path fill-rule="evenodd" d="M0 400 C 120 416 240 430 360 438 C 420 442 460 446 520 452 L520 500 C 420 510 320 516 220 508 C 140 502 60 488 0 472 Z M96 392 L176 392 L176 520 L96 520 Z M408 392 L488 392 L488 520 L408 520 Z"/>
  </g>
  <g id="region-c09" data-cell-id="c9" data-color-id="10" data-color-name="Canopy Shadow" data-color-hex="#2f4d30">
    <title>Region c9 – Color #10 (Canopy Shadow)</title>
    <path fill-rule="evenodd" d="M520 452 C 600 446 680 438 760 430 C 860 420 940 412 960 410 L960 500 C 880 512 800 520 720 520 C 640 520 560 516 520 510 Z M704 392 L784 392 L784 520 L704 520 Z M408 392 L488 392 L488 520 L408 520 Z"/>
  </g>
  <g id="region-c10" data-cell-id="c10" data-color-id="9" data-color-name="Spring Green" data-color-hex="#9dd989">
    <title>Region c10 – Color #9 (Spring Green)</title>
    <path fill-rule="evenodd" d="M0 472 C 80 494 160 512 240 522 C 300 530 360 532 420 528 L420 560 C 340 576 260 584 180 580 C 120 578 60 568 0 552 Z M96 472 L176 472 L176 580 L96 580 Z"/>
  </g>
  <g id="region-c11" data-cell-id="c11" data-color-id="9" data-color-name="Spring Green" data-color-hex="#9dd989">
    <title>Region c11 – Color #9 (Spring Green)</title>
    <path fill-rule="evenodd" d="M540 528 C 620 520 700 504 780 486 C 860 468 920 450 960 440 L960 560 C 880 576 800 588 720 588 C 640 588 580 578 540 568 Z M704 472 L784 472 L784 580 L704 580 Z"/>
  </g>
  <g id="region-c12" data-cell-id="c12" data-color-id="2" data-color-name="Forest Floor" data-color-hex="#5f432c">
    <title>Region c12 – Color #2 (Forest Floor)</title>
    <path fill-rule="evenodd" d="M0 552 C 120 580 240 596 360 598 C 440 600 520 596 600 588 C 720 576 840 556 960 528 L960 600 H0 Z M288 512 C 340 488 400 470 460 466 C 520 462 580 470 630 488 C 680 506 716 530 732 558 C 700 584 656 600 600 608 C 520 620 440 618 360 604 C 300 594 240 574 200 546 Z M408 468 L488 468 L488 600 L408 600 Z"/>
  </g>
  <g id="region-c13" data-cell-id="c13" data-color-id="8" data-color-name="Sunlight" data-color-hex="#f4cf74">
    <title>Region c13 – Color #8 (Sunlight)</title>
    <path fill-rule="evenodd" d="M288 512 C 336 488 392 470 448 466 C 512 462 576 472 624 492 C 664 510 692 536 706 568 C 684 600 648 622 600 632 C 540 644 472 640 412 624 C 356 608 312 582 292 550 C 280 532 280 522 288 512 Z M408 468 L488 468 L488 600 L408 600 Z"/>
  </g>
  <g id="region-c14" data-cell-id="c14" data-color-id="3" data-color-name="Leaf Light" data-color-hex="#b6e480">
    <title>Region c14 – Color #3 (Leaf Light)</title>
    <path fill-rule="evenodd" d="M220 420 C 260 432 300 446 340 460 C 360 468 380 478 400 490 L400 540 C 360 532 320 520 280 506 C 220 486 160 464 100 440 Z M288 420 L360 420 L360 520 L288 520 Z"/>
  </g>
  <g id="region-c15" data-cell-id="c15" data-color-id="7" data-color-name="Bark Light" data-color-hex="#c88951">
    <title>Region c15 – Color #7 (Bark Light)</title>
    <path d="M96 200 C 100 280 104 360 106 440 C 108 520 110 600 112 600 L144 600 C 148 520 150 440 150 360 C 150 280 148 220 144 200 Z"/>
  </g>
  <g id="region-c16" data-cell-id="c16" data-color-id="5" data-color-name="Bark Dark" data-color-hex="#4c2f1f">
    <title>Region c16 – Color #5 (Bark Dark)</title>
    <path d="M144 200 C 150 280 154 360 156 440 C 158 520 158 600 158 600 L176 600 L176 200 Z"/>
  </g>
  <g id="region-c17" data-cell-id="c17" data-color-id="6" data-color-name="Bark Mid" data-color-hex="#7c5133">
    <title>Region c17 – Color #6 (Bark Mid)</title>
    <path d="M408 200 C 410 300 414 400 418 500 C 420 560 422 600 422 600 L452 600 C 456 520 458 440 460 360 C 460 280 458 220 454 200 Z"/>
  </g>
  <g id="region-c18" data-cell-id="c18" data-color-id="5" data-color-name="Bark Dark" data-color-hex="#4c2f1f">
    <title>Region c18 – Color #5 (Bark Dark)</title>
    <path d="M452 200 C 456 280 458 360 460 440 C 462 520 462 600 462 600 L488 600 L488 200 Z"/>
  </g>
  <g id="region-c19" data-cell-id="c19" data-color-id="7" data-color-name="Bark Light" data-color-hex="#c88951">
    <title>Region c19 – Color #7 (Bark Light)</title>
    <path d="M704 200 C 708 288 712 376 716 464 C 718 528 720 600 722 600 L752 600 C 756 520 758 440 758 360 C 758 280 756 220 752 200 Z"/>
  </g>
  <g id="region-c20" data-cell-id="c20" data-color-id="5" data-color-name="Bark Dark" data-color-hex="#4c2f1f">
    <title>Region c20 – Color #5 (Bark Dark)</title>
    <path d="M752 200 C 756 280 758 360 760 440 C 762 520 762 600 762 600 L784 600 L784 200 Z"/>
  </g>
</svg>
`
  };
  const globalStore = (window.__starterSvgFallbacks = window.__starterSvgFallbacks || {});
  Object.assign(globalStore, fallbackSvgs);
  const applyMarker = () => {
    if (typeof document !== 'undefined' && document.body) {
      document.body.setAttribute('data-inline-fallbacks', Object.keys(globalStore).join(','));
    }
  };
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyMarker, { once: true });
  } else {
    applyMarker();
  }
})();
