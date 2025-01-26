import Image from "next/image";

interface ButtonProps {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary' | 'base';
    className?: string;
    icon?: React.ReactNode;
    iconUrl?: string;
    iconHeight?: number;
    iconWidth?: number;
}

export function Button({ children, variant = 'primary', className = '', icon, iconUrl, iconHeight, iconWidth }: ButtonProps) {
    const baseStyles = "px-6 py-2 rounded-full transition-all duration-200 focus:outline-none focus:ring-none inline-flex items-center justify-center font-funnel-display";

    const variants = {
        primary: `
            bg-[#2563E4] text-white px-10 py-6
            hover:bg-[#2563E4] hover:[background:linear-gradient(0deg,#2563E4,#2563E4),linear-gradient(0deg,rgba(0,0,0,0.2),rgba(0,0,0,0.2))]
            active:bg-[#183E81] active:[background:linear-gradient(0deg,#183E81,#183E81),linear-gradient(0deg,rgba(0,0,0,0.4),rgba(0,0,0,0.4))]
            font-funnel-display text-[28px] font-semibold leading-[28px]
        `,
        secondary: `
        bg-[#8154D4] text-white border border-[#F4F4EF] px-8
        font-funnel-display text-[24px] font-medium leading-[33.6px] tracking-[0.01em]
        hover:bg-[#8154D4] hover:[background:linear-gradient(0deg,#8154D4,#8154D4),linear-gradient(0deg,rgba(0,0,0,0.2),rgba(0,0,0,0.2))]
        active:bg-[#8154D4] active:[background:linear-gradient(0deg,#8154D4,#8154D4),linear-gradient(0deg,rgba(0,0,0,0.4),rgba(0,0,0,0.4))]
    `,
        base: "bg-[#2563EB] hover:bg-[#1D4ED8] active:bg-[#1E40AF] text-white focus:ring-[#2563EB]",
    };




    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${className}`}
            style={variant === 'secondary' ? {
                textUnderlinePosition: 'from-font',
                textDecorationSkipInk: 'none'
            } : undefined}
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