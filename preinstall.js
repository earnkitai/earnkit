const { execSync } = require('child_process');

// Check Node.js version
const nodeVersion = process.versions.node;
const major = parseInt(nodeVersion.split('.')[0], 10);

if (major < 20) {
  console.error(
    '\x1b[31m%s\x1b[0m',
    'Error: Node.js version 20 or higher is required.',
  );
  process.exit(1);
}

// Check if using pnpm
if (process.env.npm_execpath && !process.env.npm_execpath.includes('pnpm')) {
  console.error(
    '\x1b[31m%s\x1b[0m',
    'Error: Please use pnpm instead of npm or yarn',
  );
  console.log(
    '\x1b[36m%s\x1b[0m',
    'To install pnpm, run: npm install -g pnpm@latest',
  );
  process.exit(1);
}

// Check pnpm version
try {
  const pnpmVersion = execSync('pnpm --version').toString().trim();
  const major = parseInt(pnpmVersion.split('.')[0], 10);

  if (major < 8) {
    console.error(
      '\x1b[31m%s\x1b[0m',
      'Error: pnpm version 8 or higher is required.',
    );
    console.log(
      '\x1b[36m%s\x1b[0m',
      'To upgrade pnpm, run: npm install -g pnpm@latest',
    );
    process.exit(1);
  }
} catch (error) {
  console.error('\x1b[31m%s\x1b[0m', 'Error: pnpm is not installed.');
  console.log(
    '\x1b[36m%s\x1b[0m',
    'To install pnpm, run: npm install -g pnpm@latest',
  );
  process.exit(1);
}
