/* eslint-disable @typescript-eslint/no-explicit-any */
import clsx from "clsx"
import React, { Fragment } from "react"

/**
 * This type is harcoded here as I couldn't really find anything
 * in the Notion API that corresponds to the actual data
 */
interface TextProps {
  annotations: {
    bold: boolean
    italic: boolean
    strikethrough: boolean
    underline: boolean
    code: boolean
    color: string
  }
  href?: string
  plain_text: string
  text?: {
    content: string
    link?: {
      url: string
    }
  }
  type: string
}

const RenderTextContent: React.FC<
  React.PropsWithChildren<{
    isCode: boolean
    content: string
    className?: string
  }>
> = ({ isCode, content, className }) =>
    isCode ? (
      <code className="text-pink-600">{content}</code>
    ) : (
      <>
        <span className={className} dangerouslySetInnerHTML={{ __html: content.replace("\n", "<br/>") }} />
      </>
    )
// TODO fix type here
export const NotionText: React.FC<React.PropsWithChildren<{ text: TextProps[] | null | any }>> = ({ text }) => {
  if (text == null) {
    return null
  }

  return (
    <>
      {text.map((value: any, idx: number) => {
        const {
          annotations: { bold, code, italic, strikethrough, underline },
          text,
        } = value
        if (text == null) {
          return null
        }

        return (
          <Fragment key={idx}>
            {text.link != null ? (
              <a href={text.link.url} className="underline hover:text-pink-600">
                <RenderTextContent
                  isCode={code}
                  content={text.content}
                  className={clsx(
                    bold && "font-semibold",
                    italic && "italic",
                    strikethrough && "line-through",
                    underline && "underline"
                  )}
                />
              </a>
            ) : (
              <RenderTextContent
                isCode={code}
                content={text.content}
                className={clsx(
                  bold && "font-semibold",
                  italic && "italic",
                  strikethrough && "line-through",
                  underline && "underline"
                )}
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

export const NotionList: React.FC<React.PropsWithChildren<{ type: string }>> = ({ type, children }) =>
  type === "ul" ? (
    <ul className="mb-6 list-disc pl-6 font-funnel-sans font-normal text-[1.125rem]">{children}</ul>
  ) : (
    <ol className="mb-6 list-decimal pl-6 font-funnel-sans font-normal text-[1.125rem]">{children}</ol>
  )
