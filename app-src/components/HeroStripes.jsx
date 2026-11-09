import { useEffect, useRef } from 'react';
// The hero's own, larger rendering of the mark, traced from the approved
// brand-board laptop mockup ("01 / CONNECTED"): wide icy/cobalt/navy bands,
// the cobalt one ending in the arrow at the top-right, the cobalt tail fading
// out toward the bottom-left and the navy band running off the bottom edge
// into the next section. Coordinates are the mockup's own pixels, so the
// shapes match it 1:1; the small logo (ScalvyaMark MARK_PATHS), favicons and
// share image are unchanged. Order: icy, cobalt, navy.
const HERO_PATHS = [
  'M1026 162C1028.7 162.6 1030.1 163 1034 166.4C1037.9 169.7 1046.7 179 1049.5 182.1C1052.2 185.1 1050.4 183.8 1050.4 184.7C1050.4 185.7 1050.7 186.6 1049.5 188C1048.2 189.3 1049.7 189 1043 193.1C1036.2 197.2 1023.7 204.6 1009 212.6C994.3 220.6 982.8 227.4 955 240.9C927.2 254.4 875 278.6 842 293.4C809 308.2 795.2 314.1 757 329.8C718.8 345.4 645.5 373.9 613 387.5C580.5 401.1 574 405.4 562 411.2C550 416.9 551.2 415.9 541 422.1C530.8 428.3 510.3 441.9 501 448.4C491.7 455 489.9 457.2 485 461.6C480.1 466 474.6 471.6 471.5 475C468.4 478.4 467.5 480 466.4 482C465.3 484 465.1 485.2 464.9 487C464.7 488.8 464.6 489.2 465.3 493C466.1 496.8 468.9 506 469.4 510C469.8 514 469 514.8 468.1 516.9C467.2 519 466.1 520.2 463.8 522.6C461.4 525 459 527.8 454 531.3C449 534.9 440.2 540.7 434 543.8C427.8 546.9 420.6 548.8 417 549.9C413.4 551.1 413.6 550.6 412.3 550.6C410.9 550.6 410 550.3 409.1 549.8C408.2 549.2 407.5 548.7 406.8 547.4C406.2 546.1 405.7 546 405.1 542C404.4 537.9 403.3 529.2 403 523C402.7 516.8 402.5 512.3 403.3 505C404.1 497.7 406.8 487 407.6 479C408.4 471 407.8 462.8 408.2 457C408.5 451.2 408.7 449.7 409.7 444C410.8 438.3 411.5 432 414.5 423C417.5 414 423.1 399.3 427.6 390C432.2 380.7 436 374.9 441.8 367C447.5 359.1 455 349.7 462.4 342.3C469.7 335 477.9 328.9 486 322.9C494.1 317 502.5 311.6 511 306.7C519.5 301.7 527.5 297.5 537 293.2C546.5 288.8 555.5 285.1 568 280.5C580.5 275.8 596.7 270.1 612 265.2C627.3 260.3 646.8 254.7 660 250.9C673.2 247.1 672 247.1 691 242.4C710 237.6 730.3 232 774 222.4C817.7 212.9 915.7 194.1 953 185.1C990.3 176.2 987.2 172.6 998 168.9C1008.8 165.1 1013.3 163.8 1018 162.7C1022.7 161.5 1023.3 161.4 1026 162Z',
  'M1110 134.6C1121.7 131.3 1112.6 134.8 1113.6 135.4C1114.6 136 1115.7 135.7 1115.8 138.2C1115.9 140.6 1125 113.4 1114.2 150C1103.5 186.6 1062.5 321.8 1051.2 358C1039.9 394.2 1047.6 365.7 1046.4 367.4C1045.3 369.2 1044.8 368.5 1044.1 368.5C1043.4 368.5 1042.7 368.5 1042.2 367.4C1041.7 366.4 1040.7 366.7 1041.2 362C1041.8 357.3 1044.5 346.2 1045.5 339C1046.6 331.8 1045.8 329.5 1047.3 319C1048.9 308.5 1052.5 290.8 1054.7 276C1056.8 261.2 1059.4 238.4 1060.2 230C1061 221.7 1060.4 226.6 1059.7 225.9C1059 225.2 1057.4 225.2 1056.2 225.9C1055.1 226.6 1058.7 219.3 1053 230C1047.2 240.7 1031.2 272.3 1021.5 290C1011.8 307.7 1003.8 321.3 994.8 336C985.8 350.7 975.8 366 967.6 378C959.5 390 953.3 398.2 945.9 408C938.4 417.8 932.4 426.2 922.8 437C913.1 447.8 898.1 463.2 888 473C877.9 482.8 870.8 488.4 862 495.7C853.2 503.1 848.3 507.4 835 516.8C821.7 526.3 798.3 542.4 782 552.5C765.7 562.7 752.3 569.7 737 577.9C721.7 586 714.8 590.3 690 601.5C665.2 612.7 624.2 630.4 588 645.2C551.8 660 501.8 678.9 473 690.5C444.2 702 432.2 707.1 415 714.6C397.8 722 383.3 728.8 370 735.3C356.7 741.8 346 747.5 335 753.6C324 759.7 317.8 762.8 304 772.2C290.2 781.5 268.3 797 252 809.5C235.7 822.1 220.2 834.9 206 847.3C191.8 859.7 175.2 876.4 167 883.8C158.8 891.2 161.8 887 157 891.7C152.2 896.3 144.3 905.8 137.9 911.7C131.6 917.5 122.8 923.8 119 926.6C115.2 929.4 118.5 928.3 115 928.5C111.5 928.6 102.8 928.4 98 927.5C93.2 926.5 88.7 924.1 86.1 922.8C83.5 921.5 83.6 921.1 82.5 919.8C81.3 918.5 79.8 916.5 79.2 915C78.5 913.5 78.5 912.3 78.6 911C78.7 909.7 66.5 928.5 79.9 907C93.4 885.5 142.3 808.2 159.4 782C176.4 755.8 174.3 761.7 182 750C189.7 738.3 198.2 723.5 205.7 712C213.3 700.5 220.7 690.2 227.3 681C233.9 671.8 240.6 663.2 245.6 657C250.5 650.8 251.9 649.5 257.1 644C262.4 638.5 270.9 629.8 277 624.1C283.1 618.4 287.8 614.7 294 609.8C300.2 605 306.2 600.4 314 595C321.8 589.6 329 584.1 341 577.4C353 570.7 366.7 563.3 386 554.5C405.3 545.8 416.7 539.9 457 525.2C497.3 510.4 589.2 479.9 628 465.9C666.8 451.9 669 450.1 690 441.2C711 432.3 737.2 420.5 754 412.6C770.8 404.7 779.2 400 791 393.7C802.8 387.3 809.3 384 825 374.6C840.7 365.1 866.5 349.3 885 336.8C903.5 324.3 922.5 309.9 936 299.5C949.5 289.2 954.5 284.6 966 274.7C977.5 264.7 990.4 253.6 1005 239.8C1019.6 226 1045 200.6 1053.4 192C1061.9 183.4 1055.3 189.2 1055.7 188C1056.1 186.9 1055.9 186 1055.6 185.1C1055.3 184.2 1054.7 183.4 1053.7 182.7C1052.8 182.1 1061.4 181.2 1050 181.2C1038.5 181.3 996.7 182.8 985 183C973.3 183.2 980.7 182.8 979.9 182.4C979 181.9 972.2 183.3 979.9 180.3C987.6 177.2 1015.5 168.4 1026 164.3C1036.5 160.2 1029 160.7 1043 155.7C1057 150.8 1098.2 138 1110 134.6Z',
  'M917.9 545C918.8 544.5 920.2 544.6 923.1 545.6C925.9 546.6 926.8 546.6 935 551C943.2 555.3 961.3 564.7 972 571.8C982.7 578.8 992.2 587.4 999 593.3C1005.8 599.1 1009 602.9 1012.8 607C1016.6 611.1 1018.1 612.5 1021.9 618C1025.7 623.5 1031.8 632.2 1035.7 640C1039.6 647.8 1043.2 658 1045.5 665C1047.8 672 1048.4 676.8 1049.3 682C1050.1 687.2 1050.6 689.7 1050.6 696C1050.6 702.3 1050.4 711.7 1049.2 720C1048 728.3 1046 737.3 1043.3 746C1040.5 754.7 1037.8 762.5 1032.8 772C1027.8 781.5 1020.2 793.5 1013.4 803C1006.5 812.5 999.1 821 991.8 829C984.4 837 977.6 843.4 969 851.1C960.4 858.7 952.5 865.6 940 874.9C927.5 884.2 908.8 897.3 894 907C879.2 916.7 922.1 893.5 851 933.1C779.9 972.8 532.5 1109 467.1 1144.9C401.8 1180.7 557.4 1147.7 458.8 1148.4C360.1 1149.1 -5.1 1148.9 -125 1149C-244.9 1149.1 -237.3 1149.1 -260.9 1149C-284.6 1148.8 -265.9 1148.7 -266.7 1148.3C-267.5 1147.8 -340.6 1181.7 -265.8 1146.4C-191 1111 96.4 976.1 182 936.2C267.6 896.3 227 915.8 248 906.9C269 897.9 289.7 889.9 308 882.8C326.3 875.7 332.5 873 358 864.2C383.5 855.5 415.8 844.2 461 830.2C506.2 816.1 585.3 793.4 629 780.1C672.7 766.8 698.7 758.5 723 750.5C747.3 742.4 761.2 737.1 775 731.8C788.8 726.6 796.7 723.1 806 719.1C815.3 715.1 822.5 712.1 831 707.9C839.5 703.7 848 699.3 857 693.8C866 688.3 877.2 680.8 885 674.9C892.8 668.9 898.5 663.6 904 658C909.4 652.3 913.9 647 918 641C922 635 925.7 628.2 928.2 622C930.7 615.8 932.3 610.2 933.1 604C933.8 597.8 933.4 590.7 932.7 585C931.9 579.3 931.1 576.1 928.6 570C926.1 563.9 919.6 552.6 917.8 548.4C916 544.3 917 545.5 917.9 545Z',
];




// The navy band is continued below the mockup's bottom edge (y 958) along
// its own edge directions, so the mark can sit as high as on the mockup and
// the band still runs off the hero's bottom edge.
const HERO_VIEW_BOX = '40 120 1100 1030';

export default function HeroStripes() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const sky = root.closest('.lp-sky');
    let skyHeight = sky ? sky.offsetHeight : window.innerHeight;
    let ticking = false;

    function measure() {
      skyHeight = sky ? sky.offsetHeight : window.innerHeight;
    }

    function apply() {
      ticking = false;
      const p = skyHeight > 0 ? Math.min(1, Math.max(0, window.scrollY / skyHeight)) : 0;
      root.style.setProperty('--hero-p', p.toFixed(4));
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(apply);
      }
    }

    measure();
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div className="lp-hero-art" aria-hidden="true" ref={rootRef}>
      <svg viewBox={HERO_VIEW_BOX} fill="none" preserveAspectRatio="xMaxYMax meet">
        <defs>
          <linearGradient id="heroArtIce" gradientUnits="userSpaceOnUse" x1="420" y1="500" x2="1050" y2="170">
            <stop offset="0%" stopColor="#bfe1fe" />
            <stop offset="100%" stopColor="#93cdfb" />
          </linearGradient>
          {/* Cobalt fades out along its bottom-left tail, as on the mockup. */}
          <linearGradient id="heroArtCobalt" gradientUnits="userSpaceOnUse" x1="70" y1="950" x2="1117" y2="134">
            <stop offset="0%" stopColor="#9dbaf8" stopOpacity="0" />
            <stop offset="14%" stopColor="#7aa0f5" stopOpacity="0.9" />
            <stop offset="36%" stopColor="#3a6ff4" />
            <stop offset="100%" stopColor="#1f5cf2" />
          </linearGradient>
          <linearGradient id="heroArtNavy" gradientUnits="userSpaceOnUse" x1="140" y1="958" x2="1050" y2="600">
            <stop offset="0%" stopColor="#2f5fe0" />
            <stop offset="30%" stopColor="#1d3fae" />
            <stop offset="62%" stopColor="#14338f" />
            <stop offset="100%" stopColor="#0f1e51" />
          </linearGradient>
          {/* A soft, narrow light band used for the slow sheen sweep below -
              transparent on both sides, a touch of white in the middle, so
              it reads as a gentle highlight travelling over the ribbon
              rather than a hard stripe. */}
          <linearGradient id="heroArtSheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="42%" stopColor="#fff" stopOpacity="0" />
            <stop offset="50%" stopColor="#fff" stopOpacity="0.32" />
            <stop offset="58%" stopColor="#fff" stopOpacity="0" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          {/* Clips the sheen rects below to each band's own silhouette
              (same d as the band itself), so the moving highlight never
              spills outside the ribbon it is meant to catch. */}
          <clipPath id="heroClipNavy"><path d={HERO_PATHS[2]} /></clipPath>
          <clipPath id="heroClipCobalt"><path d={HERO_PATHS[1]} /></clipPath>
        </defs>
        <path d={HERO_PATHS[0]} className="mark-band mark-band-ice" fill="url(#heroArtIce)" />
        <path d={HERO_PATHS[2]} className="mark-band mark-band-navy" fill="url(#heroArtNavy)" />
        <path d={HERO_PATHS[1]} className="mark-band mark-band-cobalt" fill="url(#heroArtCobalt)" />
        {/* Premium, calm "sheen": a soft highlight drifting slowly down the
            ribbon every few seconds, independent of the hover/entrance/
            parallax motion above - transform-only (translate), so it never
            triggers layout on scroll. Off-canvas (translateY(-90px)) by
            default; the no-preference media query below is what actually
            sets it moving, so a reduced-motion visitor's "default" IS the
            finished, static state - never a stray highlight caught
            mid-sweep. */}
        <g clipPath="url(#heroClipNavy)">
          <rect className="mark-sheen mark-sheen-navy" x="40" y="-700" width="1100" height="1000" fill="url(#heroArtSheen)" />
        </g>
        <g clipPath="url(#heroClipCobalt)">
          <rect className="mark-sheen mark-sheen-cobalt" x="40" y="-700" width="1100" height="1000" fill="url(#heroArtSheen)" />
        </g>
      </svg>
    </div>
  );
}
