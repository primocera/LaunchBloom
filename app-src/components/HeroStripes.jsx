import { useEffect, useRef } from 'react';
// The hero's own, larger rendering of the mark, traced from the approved
// brand-board laptop mockup ("01 / CONNECTED"): wide icy/cobalt/navy bands,
// the cobalt one ending in the arrow at the top-right, the cobalt tail fading
// out toward the bottom-left and the navy band running off the bottom edge
// into the next section. Coordinates are the mockup's own pixels, so the
// shapes match it 1:1; the small logo (ScalvyaMark MARK_PATHS), favicons and
// share image are unchanged. Order: icy, cobalt, navy.
const HERO_PATHS = [
  'M994 176.8C999.6 175.7 1005.3 175.9 1011 176.1C1025 176.6 1039 177.6 1052.9 178.7C1055.3 178.9 1057.6 179.4 1059.8 180.2C1060.3 180.4 1060.6 181.1 1060.6 181.7C1060.6 182.2 1060.3 182.8 1059.8 183.1C1056.4 185.6 1052.8 188 1049 190.1C1011.5 210.3 974.1 230.8 936 249.8C904.8 265.3 872.8 279.4 841 293.8C824.1 301.5 807.2 309.1 790 316.1C738.5 337.4 687 358.9 635 379C616.6 386.1 597.4 390.8 579 397.7C566.7 402.4 554.9 408 543 413.6C538.5 415.7 534.1 418.1 530 420.8C521.8 426.1 513.5 431.3 506 437.6C494.8 447.1 484.4 457.4 474.3 468C462.9 479.9 452 492.3 441.4 505C437.2 510 433.5 515.5 429.9 521C426.3 526.4 423.4 532.1 419.8 537.5C418.9 538.8 417.8 540.1 416.5 540.9C415.9 541.3 415.1 541.2 414.5 540.9C413.8 540.5 413.3 539.8 413.1 539C412.2 535.7 411.6 532.4 411.3 529C409.9 514 408.9 499 408.2 484C407.8 476 407.5 468 408.1 460C408.8 450.6 410.1 441.2 412.1 432C414.4 421.5 417.7 411.2 421.1 401C422.2 397.5 423.9 394.2 425.7 391C429.9 383.2 434.2 375.5 438.9 368C442.1 363.1 445.4 358.3 449.3 354C456.1 346.6 463.1 339.2 471 332.9C480.4 325.4 490.7 319 501 312.8C512 306.1 523.4 299.8 535 294.2C545.7 289 556.8 284.7 568 280.5C583.9 274.6 599.8 269 616 263.9C638.5 256.9 661.1 250 684 244.2C728.1 233.1 772.5 222.8 817 213.1C875.9 200.3 934.8 188 994 176.8Z',
  'M928.5 430C919.6 439.6 911.1 449.7 901.9 459C892.3 468.8 882.4 478.3 872 487.3C860.4 497.3 848.2 506.8 836 516C826.6 523.1 816.8 529.8 807 536.4C798.1 542.3 789.2 548.2 780 553.6C766.5 561.6 752.9 569.3 739 576.7C722.8 585.3 706.7 593.8 690 601.4C656.6 616.5 622.9 630.8 589 644.7C550.2 660.6 510.9 675.3 472 690.9C453.9 698.2 435.9 705.6 418 713.4C401.5 720.6 385.2 728 369 735.9C357.1 741.6 345.5 747.8 334 754.3C323.8 760 313.7 765.9 304 772.5C283.6 786.5 263.6 801 244 816C230.9 826 218.4 836.7 206 847.5C188.5 862.9 171.2 878.6 154.2 894.5C148.5 899.9 143.5 906 137.8 911.3C133.1 915.5 128.1 919.2 123 922.9C121.1 924.3 119.1 925.6 117 926.5C115.4 927.2 113.7 927.8 112 927.8C106.3 927.7 100.6 927.3 95 926.2C92.2 925.6 89.6 924.2 87.3 922.7C85.2 921.3 83.3 919.6 81.9 917.6C80.8 915.9 80 913.9 80 912C79.9 909.6 80.2 907 81.4 905C106.5 863.9 132.6 823.4 158.8 783C166.5 771.1 175.3 759.8 183.2 748C194.6 730.8 205.1 713 216.7 696C225.1 683.7 234.2 671.8 243.4 660C247.7 654.4 252.5 649.2 257.3 644C262.7 638.2 268.1 632.4 274 627.2C283 619 292.4 611.3 302 603.8C309.7 597.9 317.9 592.4 326 587C332.9 582.5 339.8 577.9 347 574C358.8 567.6 370.9 561.8 383 556.1C392.9 551.4 402.9 547.2 413 543C428.9 536.5 444.8 529.7 461 523.9C517.1 503.7 573.9 485.3 630 465C651.3 457.3 672.2 448.6 693 439.8C711.8 431.9 730.5 423.7 749 415C763.5 408.1 777.9 400.7 792 393C810.2 383 828.3 372.8 846 362C863.7 351.1 881 339.8 898 327.9C912.4 317.8 926.2 306.9 940 296C946.9 290.6 953.3 284.7 960 279C966.7 273.3 973.4 267.8 980 262C986.7 256.1 993.4 250.1 1000 244C1006.8 237.8 1013.3 231.3 1020 225C1026.7 218.7 1033.4 212.4 1040 206C1048.8 197.4 1066 180 1066 180C1066 180 972 183 972 183C972 183 1113 137 1113 137C1113 137 1043 371 1043 371C1043 371 1063 207 1063 207C1063 207 1047.9 239.1 1040 255C1033.6 267.8 1026.9 280.4 1020 293C1013.5 304.8 1006.9 316.5 1000 328C993.6 338.8 986.9 349.5 980 360C973.6 369.8 966.7 379.3 960 389C953.3 398.7 947.2 408.7 940 418C936.6 422.4 932.2 425.9 928.5 430Z',
  'M918.5 545.6C919.4 544.6 921.1 545.3 922.4 545.6C924.7 546.1 926.9 547.1 929 548.1C940.1 553.7 951.2 559.3 962 565.4C967.2 568.4 972.2 571.9 977 575.5C984.2 580.9 991.3 586.4 998 592.4C1003.8 597.6 1009.3 603.2 1014.5 609C1018.7 613.7 1022.6 618.8 1026.1 624C1029.8 629.4 1033.2 635.1 1036.1 641C1039 646.8 1041.5 652.8 1043.5 659C1045.7 665.9 1047.4 672.9 1048.7 680C1049.8 686.3 1050.5 692.6 1050.6 699C1050.7 705.3 1050.1 711.7 1049.3 718C1048.3 725.1 1046.8 732.1 1045 739C1043.5 745.1 1041.6 751.1 1039.3 757C1036.9 763.2 1034.2 769.2 1031.1 775C1027.4 781.9 1023.3 788.5 1018.9 795C1014.7 801.2 1010.2 807.2 1005.5 813C1000.8 818.9 995.8 824.5 990.7 830C985.7 835.4 980.4 840.6 975 845.6C968.2 851.8 961.2 857.8 954 863.7C947.2 869.3 940.2 874.8 933 880C914.2 893.3 894.8 905.7 876 918.9C674.2 1060.8 473.1 1203.8 271 1345.4C268.7 1347 265.8 1347.8 263 1348.4C259.7 1349 256.3 1349 253 1349C-0.7 1349.2 -254.3 1349 -508 1349C-535 1349 -562 1349.2 -588.9 1348.9C-591 1348.9 -593.1 1348.7 -595.1 1348.1C-596.3 1347.8 -597.6 1347.2 -598.1 1346.1C-599.3 1343.2 -599.9 1340.1 -600 1337C-600.5 1308.3 -600.3 1279.7 -599.9 1251.1C-599.9 1248.7 -599.6 1246.1 -598.5 1244C-597.4 1241.9 -595.7 1240 -593.5 1239.1C-323.3 1131.7 -52.4 1026.3 218 919.5C249.5 907.1 280.5 893.7 312 881.3C328.2 874.9 344.5 868.9 361 863.2C393.9 852 426.8 840.8 460 830.5C515.8 813.2 572.1 797.4 628 780.4C659.1 770.9 690.1 761.3 721 751.1C739.5 745 757.8 738.5 776 731.4C792.5 725 808.9 718.2 825 710.7C837 705.1 848.7 698.9 860 692C869.4 686.3 878.5 680.1 887 673.2C894.7 667.1 902 660.3 908.6 653C913.8 647.2 918.4 640.8 922.2 634C926 627.4 928.7 620.2 931.3 613C932.4 609.8 932.7 606.4 933.1 603C933.5 599.7 933.7 596.3 933.4 593C932.8 586.9 931.8 580.9 930.3 575C929.2 570.8 927.4 566.9 925.6 563C923.5 558.4 920.5 554.2 918.6 549.5C918.1 548.3 917.6 546.5 918.5 545.6Z',
];










// The navy band is continued below the mockup's bottom edge (y 958) along
// its own edge directions, so the mark can sit as high as on the mockup and
// the band still runs off the hero's bottom edge.
// It runs on 200 units below the hero's edge (y 1150-1350, clipped) so the
// scroll drift can never lift it off the seam.
const HERO_VIEW_BOX = '40 120 1100 1230';

export default function HeroStripes() {
  const rootRef = useRef(null);

  // Scroll drift: one passive listener + rAF writes --hero-p (0 -> 1 across
  // the hero); landing.css drifts, turns and shrinks the mark with it. The
  // navy band runs on below the clip, so no gap can open at the seam.
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
          {/* The sheen: a soft, narrow light band drifting over the cobalt and
              navy bands, clipped to each band's own silhouette. */}
          <linearGradient id="heroArtSheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="42%" stopColor="#fff" stopOpacity="0" />
            <stop offset="50%" stopColor="#fff" stopOpacity="0.32" />
            <stop offset="58%" stopColor="#fff" stopOpacity="0" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id="heroClipNavy"><path d={HERO_PATHS[2]} /></clipPath>
          <clipPath id="heroClipCobalt"><path d={HERO_PATHS[1]} /></clipPath>
        </defs>
        <path d={HERO_PATHS[0]} className="mark-band mark-band-ice" fill="url(#heroArtIce)" />
        <path d={HERO_PATHS[2]} className="mark-band mark-band-navy" fill="url(#heroArtNavy)" />
        <path d={HERO_PATHS[1]} className="mark-band mark-band-cobalt" fill="url(#heroArtCobalt)" />
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
