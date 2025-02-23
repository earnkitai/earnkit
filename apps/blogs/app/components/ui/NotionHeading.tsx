import { RichTextItemResponse } from "@notionhq/client/build/src/api-endpoints"
import { NotionText } from "./NotionText"

type HeadingTypes = "heading_1" | "heading_2" | "heading_3"
interface HeadingConfig {
  classes: string
  as: string
}
const headingConfig: Record<HeadingTypes, HeadingConfig> = {
  heading_1: {
    classes: "text-4xl font-bold leading-snug mt-16 mb-6",
    as: "h1",
  },
  heading_2: {
    classes: "text-2xl font-bold mt-16 mb-6",
    as: "h2",
  },
  heading_3: {
    classes: "text-xl font-bold mt-6 mb-4",
    as: "h3",
  },
}

interface Props {
  type: HeadingTypes
  text: RichTextItemResponse[]
}
export const NotionHeading: React.FC<React.PropsWithChildren<Props>> = ({ type, text }) => {
  // const id = convertHeadingToId(text)
  const config = headingConfig[type]

  return (
    <>
      {type === "heading_1" && (
        <h1 className={config.classes + " font-funnel-sans font-semibold text-black mt-6 mb-6"}>
          <NotionText text={text} />
        </h1>
      )}
      {type === "heading_2" && (
        <h2 className={config.classes + " font-funnel-sans font-semibold text-black mt-6 mb-6"}>
          <NotionText text={text} />
        </h2>
      )}
      {type === "heading_3" && (
        <h3 className={config.classes + " font-funnel-sans font-semibold text-black mt-6 mb-6"}>
          <NotionText text={text} />
        </h3>
      )}
    </>
  )
}
