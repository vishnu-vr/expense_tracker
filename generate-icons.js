const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputSvg = path.join(__dirname, 'src/assets/icons/icon.svg');
const outputDir = path.join(__dirname, 'src/assets/icons');

async function generateIcons() {
    const svgBuffer = fs.readFileSync(inputSvg);
    
    for (const size of sizes) {
        const outputPath = path.join(outputDir, `icon-${size}x${size}.png`);
        
        await sharp(svgBuffer)
            .resize(size, size)
            .png()
            .toFile(outputPath);
        
        console.log(`Generated: icon-${size}x${size}.png`);
    }
    
    console.log('\nAll icons generated successfully!');
}

generateIcons().catch(console.error);

