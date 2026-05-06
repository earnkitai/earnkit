export default function YoutubeEmbed() {
  return ( //bg-color3
    <div className="w-full min-h-[90vh] bg-color3 rounded-[56px] flex items-center justify-center p-8 md:p-20">
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl md:rounded-[3rem] border-2 border-color11">
        <div className="relative pb-[56.25%] h-0">
          <iframe
            className="absolute top-0 left-0 w-full h-full"
            src="https://www.youtube.com/embed/dQw4w9WgXcQ"
            title="YouTube video player"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          ></iframe>
        </div>
      </div>
    </div>
  );
}