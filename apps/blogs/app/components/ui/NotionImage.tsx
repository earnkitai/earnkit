export const NotionImage: React.FC<React.PropsWithChildren<{ src: string; alt: string }>> = ({ src, alt }) => {
  // janky fix for - need to figure out why blank slots are being passed through
  return <div className="imageContainer w-full">{src.slice(0, 4) === "data" ? <></> : <img src={src} alt={alt} />}</div>
}
