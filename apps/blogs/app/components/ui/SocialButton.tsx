'use client'

import { Button } from "../common/Button"

interface SocialButtonProps {
    icon: React.ReactNode;
    children: React.ReactNode;
    link: string;
    variant?: "primary" | "secondary" | "outline";
    className?: string;
}

export const SocialButton = ({ icon, children, link, variant = "primary", className }: SocialButtonProps) => {
    return (
        <Button
            variant={variant}
            icon={icon}
            onClick={() => window.open(link, "_blank")}
            className={className}
        >
            {children}
        </Button>
    )
} 