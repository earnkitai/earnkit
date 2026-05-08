import React from 'react';

export const NotionImage: React.FC<
  React.PropsWithChildren<{ src: string; alt: string }>
> = ({ src, alt }) => {
  // If the src is missing or empty, don't render anything
  if (!src) return null;

  return (
    <div className="imageContainer w-full flex justify-center my-4">
      <img
        src={src}
        alt={alt || 'Notion Content Image'}
        className="rounded-md max-w-full h-auto"
        loading="lazy"
      />
    </div>
  );
};
