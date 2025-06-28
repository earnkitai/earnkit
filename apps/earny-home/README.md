# Earny Home

A Next.js project for the Earny platform homepage.

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

Then, run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Tech Stack

- **Framework**: Next.js 15
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Fonts**: Funnel Display & Funnel Sans
- **Animation**: Framer Motion

## Project Structure

```
apps/earny-home/
├── app/
│   ├── components/
│   │   ├── common/          # Common components
│   │   ├── forms/           # Form components
│   │   ├── sections/        # Page sections
│   │   └── ui/              # UI components
│   ├── constants/           # Constants and config
│   ├── hooks/               # Custom hooks
│   ├── lib/                 # Utility libraries
│   ├── styles/              # Additional styles
│   ├── types/               # TypeScript types
│   ├── globals.css          # Global styles
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Home page
├── public/                  # Static assets
│   └── images/              # Image assets
├── package.json             # Dependencies
├── tailwind.config.ts       # Tailwind configuration
├── next.config.ts           # Next.js configuration
├── tsconfig.json            # TypeScript configuration
├── eslint.config.mjs        # ESLint configuration
└── postcss.config.mjs       # PostCSS configuration
```

## Available Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

## Customization

This project uses the same design system as the main EarnKit frontend, including:

- Custom color palette
- Funnel Display & Funnel Sans fonts
- Tailwind CSS configuration
- Global styles and animations

## Deployment

This project can be deployed to any platform that supports Next.js applications.
