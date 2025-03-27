import Image from "next/image";

interface ButtonProps {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary' | 'base' | 'outline';
    className?: string;
    icon?: React.ReactNode;
    iconUrl?: string;
    iconHeight?: number;
    iconWidth?: number;
    onClick?: () => void;
}

export function Button({ children, variant = 'primary', className = '', icon, iconUrl, iconHeight, iconWidth, onClick }: ButtonProps) {
    const baseStyles = "px-6 py-2 rounded-full inline-flex items-center justify-center font-funnel-display";

    const variants = {
        primary: `
            text-primary-foreground px-[2.8rem] lg:px-[3.1rem] py-6
            text-[28px] font-semibold leading-[28px]
            bg-primary hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90
            primary-btn
        `,
        outline: `
            px-[2.8rem] lg:px-[3.1rem] py-6
            text-[28px] font-semibold leading-[28px]
            border border-input bg-background hover:bg-accent hover:text-accent-foreground
            dark:border-input dark:bg-background dark:hover:bg-accent dark:hover:text-accent-foreground
        `,
        secondary: `
            text-primary-foreground border border-2 border-input px-8
            font-funnel-display text-[24px] font-medium leading-[33.6px] tracking-[0.01em]
            bg-secondary hover:bg-secondary/80 dark:bg-secondary dark:hover:bg-secondary/80
        `,
        base: "bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground focus:ring-primary dark:bg-primary dark:hover:bg-primary/90 dark:active:bg-primary/80 dark:text-primary-foreground dark:focus:ring-primary",
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${className}`}
            style={variant === 'secondary' ? {
                textUnderlinePosition: 'from-font',
                textDecorationSkipInk: 'none'
            } : undefined}
            onClick={onClick}
        >
            {iconUrl && (
                <Image
                    src={iconUrl}
                    alt="icon"
                    width={iconWidth || 30}
                    height={iconHeight || 30}
                    objectFit="fit"
                    className="mr-2"
                />
            )}
            {icon && <span className="mr-2 flex items-center justify-center w-[40px] h-[40px]">{icon}</span>}
            {children}
        </button>
    );
} 