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
  'M918.5 545.6C919.1 544.8 920.6 545.2 921.6 545.4C923.8 545.9 926 546.7 928 547.7C938.1 552.6 948.2 557.7 958 563.1C963.2 566 968.2 569.1 973 572.5C979.5 577.2 985.9 582.1 992 587.2C997.2 591.6 1002.2 596.2 1007 601C1011.4 605.5 1015.6 610.1 1019.5 615C1023.3 619.8 1026.8 624.8 1030 630C1033 634.8 1035.6 639.8 1038 645C1040.3 650.2 1042.4 655.5 1044.1 661C1046 667.2 1047.6 673.6 1048.7 680C1049.7 685.9 1050.3 692 1050.6 698C1050.7 702.7 1050.4 707.4 1049.9 712C1049.3 717.7 1048.5 723.4 1047.3 729C1045.8 736.1 1044.1 743.1 1041.9 750C1039.9 756.2 1037.4 762.2 1034.6 768C1031.8 773.8 1028.8 779.5 1025.3 785C1020.4 792.9 1015.2 800.6 1009.5 808C1003.3 816 996.7 823.6 989.8 831C983.2 838 976.2 844.6 969 851C959.9 859 950.9 867 941 874C812.5 965.2 683.4 1055.7 554 1145.6C551.7 1147.2 548.8 1147.9 546 1148.4C542.7 1149 539.3 1149 536 1149C284.7 1149.2 33.3 1149 -218 1149C-263.6 1149 -309.1 1149.4 -354.7 1148.9C-356.2 1148.9 -359.7 1149 -359.2 1147.5C-358.4 1145.3 -355.1 1144.9 -352.9 1144C-123.7 1053.3 105.3 962.2 335 872.7C361 862.6 387.6 854.1 414 845.2C429.2 840.1 444.6 835.2 460 830.5C515.9 813.6 572.1 797.4 628 780.4C659.4 770.8 690.8 761.2 722 750.8C741.5 744.3 760.8 737.2 780 729.8C793.5 724.6 806.8 718.8 820 713C827.1 709.8 834.2 706.4 841 702.7C850.2 697.7 859.3 692.7 868 686.9C877 680.9 885.8 674.5 894 667.4C900.8 661.5 907.2 655 912.8 648C917.7 641.8 921.9 635.1 925.4 628C928.4 622 930.9 615.6 932.2 609C933.5 602.8 933.6 596.3 933.2 590C932.8 584.2 931.6 578.4 929.7 573C926.7 564.9 921.9 557.5 918.6 549.5C918.1 548.3 917.8 546.7 918.5 545.6Z',
];









// The navy band is continued below the mockup's bottom edge (y 958) along
// its own edge directions, so the mark can sit as high as on the mockup and
// the band still runs off the hero's bottom edge.
const HERO_VIEW_BOX = '40 120 1100 1030';

export default function HeroStripes() {
  const rootRef = useRef(null);

  // Scroll drift: one passive listener + rAF writes --hero-p (0 -> 1 across
  // the hero); landing.css scales the art up from its bottom edge with it, so
  // the arrow rises while the bands stay on the seam (no gap can open).
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
        </defs>
        <path d={HERO_PATHS[0]} className="mark-band mark-band-ice" fill="url(#heroArtIce)" />
        <path d={HERO_PATHS[2]} className="mark-band mark-band-navy" fill="url(#heroArtNavy)" />
        <path d={HERO_PATHS[1]} className="mark-band mark-band-cobalt" fill="url(#heroArtCobalt)" />
      </svg>
    </div>
  );
}
