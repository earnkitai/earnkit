'use client';

import { useEffect, useRef } from 'react';

export default function BackgroundVideoLandingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Standard play function with promise handling
    const attemptPlay = () => {
      video.play().catch((error) => {
        // Log the error but don't let it interrupt the app
        console.warn('Autoplay prevented or interrupted:', error.message);
      });
    };

    attemptPlay();

    // Fallback: If power saving blocked it, try playing again on the first user interaction
    const handleGesture = () => {
      attemptPlay();
      window.removeEventListener('click', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
    };

    window.addEventListener('click', handleGesture);
    window.addEventListener('touchstart', handleGesture);

    return () => {
      window.removeEventListener('click', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      className="absolute top-0 md:-top-[25%] left-0 w-full md:w-[150%] h-[95vh] md:h-[150%] object-cover -z-10"
    >
      <source src="/videos/HERO_ANIMATION.mp4" type="video/mp4" />
      <source
        src="https://res.cloudinary.com/coinvise/video/upload/v1747895552/DESKTOP_mnwas8.mp4"
        type="video/mp4"
      />
    </video>
  );
}
