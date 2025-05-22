"use client";

import { useEffect, useRef } from "react";

export default function BackgroundVideoLandingPage() {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        // Ensure video starts playing when component mounts
        if (videoRef.current) {
            videoRef.current.play().catch(() => {
                // Handle autoplay failure silently
            });
        }
    }, []);

    return (
        <video
            ref={videoRef}
            autoPlay
            preload="auto"
            loop
            muted
            playsInline
            className="absolute -top-[25%] left-0 w-[150%] h-[150%] object-cover -z-10"
            poster="/images/landing/hero_video_poster.png"
        >
            <source
                src="https://res.cloudinary.com/coinvise/video/upload/v1747895552/DESKTOP_mnwas8.mp4"
                type="video/mp4"
            />
            Your browser does not support the video tag.
        </video>
    );
}
