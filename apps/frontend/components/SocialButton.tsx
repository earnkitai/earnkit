'use client'

import { Button } from "./ui/Button"

interface SocialButtonProps {
    icon: React.ReactNode;
    children: React.ReactNode;
    link: string;
    variant?: "primary" | "secondary";
}

export const SocialButton = ({ icon, children, link, variant = "primary" }: SocialButtonProps) => {
    return (
        <Button
            variant={variant}
            icon={icon}
            onClick={() => window.open(link, "_blank")}
        >
            {children}
        </Button>
    )
} 