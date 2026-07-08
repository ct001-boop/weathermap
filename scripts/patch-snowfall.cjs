const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'src', 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');

const oldFunction = `function computeSnowfall(precip, temp, snowline, gridElev) {
  return precip.map((p, i) => {
    if (p == null || p <= 0) return 0;
    const t = temp[i];
    const sl = snowline[i];
    const coldEnoughAtGrid = t != null && t <= 0.8;
    const gridAboveSnowline = sl != null && gridElev >= sl;
    const marginal = t != null && t > 0.8 && t <= 1.8;
    if (gridAboveSnowline || coldEnoughAtGrid) return p * 1.0;
    if (marginal) return p * 0.5;
    return 0;
  });
}`;

const newFunction = `function computeSnowfall(precip, temp, snowline, gridElev) {
  return precip.map((p, i) => {
    if (p == null || p <= 0) return 0;

    const t = temp[i];
    const sl = snowline[i];
    const gridAboveSnowline = sl != null && gridElev >= sl;

    // Convert liquid precipitation in mm into approximate settled snowfall in cm.
    // This intentionally should not mirror precipitation: colder snow produces
    // more depth per mm; wet or marginal snow produces much less.
    let snowFraction = 0;
    if (gridAboveSnowline) snowFraction = 1;
    if (t != null) {
      if (t <= -8) snowFraction = Math.max(snowFraction, 1);
      else if (t <= -4) snowFraction = Math.max(snowFraction, 1);
      else if (t <= -1) snowFraction = Math.max(snowFraction, 0.95);
      else if (t <= 0.5) snowFraction = Math.max(snowFraction, 0.75);
      else if (t <= 1.5) snowFraction = Math.max(snowFraction, 0.35);
      else if (!gridAboveSnowline) snowFraction = 0;
    }

    if (snowFraction <= 0) return 0;

    // cm of snow per mm of liquid precipitation.
    // 10:1 snow ratio = 1 cm per 1 mm. Colder/fluffier snow is higher;
    // wet snow is lower.
    let cmPerMm = 1.0;
    if (t != null) {
      if (t <= -10) cmPerMm = 1.8;
      else if (t <= -6) cmPerMm = 1.5;
      else if (t <= -3) cmPerMm = 1.25;
      else if (t <= -1) cmPerMm = 1.0;
      else if (t <= 0.5) cmPerMm = 0.7;
      else cmPerMm = 0.35;
    }

    return p * cmPerMm * snowFraction;
  });
}`;

if (source.includes(newFunction)) {
  console.log('Snowfall estimator already patched.');
  process.exit(0);
}

if (!source.includes(oldFunction)) {
  console.warn('Original snowfall estimator not found. Leaving src/main.js unchanged.');
  process.exit(0);
}

source = source.replace(oldFunction, newFunction);
fs.writeFileSync(mainPath, source);
console.log('Patched snowfall estimator.');
