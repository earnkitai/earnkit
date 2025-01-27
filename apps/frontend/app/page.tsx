import Image from "next/image";
import { Button } from "../components/ui/Button";
import Link from "next/link";
import { InvestorsIcons } from "@/components/TeamIcons";
import { SocialButton } from "@/components/SocialButton";

export default function Home() {
  return (
    <>
      <div className="min-h-screen flex flex-col lg:flex-row">
        {/* Left Section - 100vh */}
        <div className="w-full lg:w-1/2 bg-[#2563E4] h-dvh lg:min-h-screen p-4 py-10 lg:py-30 lg:p-8 lg:py-20 flex flex-col items-center justify-center rounded-[56px]">
          {/* Top Logo */}
          <div className="w-full flex mb-10 lg:mb-0 items-center justify-center text-center object-contain">
            <Image
              src={"/images/landing/logo.png"}
              height={400}
              width={400}
              className="mb-10 w-[50%] lg:w-[10rem]"
              alt="EarnKit Logo"
              priority
              quality={100}
            />


          </div>

          {/* Main Content */}
          <div className="max-w-[85%] lg:max-w-[60%] text-center lg:flex-1 flex flex-col justify-center">
            <h2 className="text-white font-funnel-display text-[3rem] lg:text-[3.5rem] font-normal leading-tight mb-8">
              Create specialized AI agents in minutes
            </h2>

          </div>

          <div className="w-full flex items-center justify-center mt-14 lg:mt-0">
            <span
              className="flex justify-between items-center gap-2 px-8 py-4   bg-transparent rounded-full border border-2  border-[#F4F4EF] font-funnel-display font-medium text-[18px] leading-[20px] border border-[#F4F4EF] disabled pointer-events-none">
              Only on
              <svg width="76" height="17" viewBox="0 0 76 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M20.1878 10.6665C20.1878 16.1894 15.7015 20.6665 10.1673 20.6665C4.91677 20.6665 0.609426 16.6366 0.181641 11.5071H13.4265V9.82592H0.181641C0.609426 4.69643 4.91677 0.666504 10.1673 0.666504C15.7015 0.666504 20.1878 5.14365 20.1878 10.6665ZM57.3376 18.8548C60.8098 18.8548 63.0871 16.984 63.0871 14.1666C63.0871 11.5519 61.3735 10.3122 58.7807 9.88396L56.4809 9.50084C54.7224 9.20781 53.5498 8.44142 53.5498 6.75097C53.5498 5.03796 54.8576 3.73067 57.3376 3.73067C59.7502 3.73067 60.9902 4.94781 61.1254 6.68336H62.8617C62.7264 4.38432 60.9677 2.3332 57.3602 2.3332C53.7978 2.3332 51.8364 4.33923 51.8364 6.8186C51.8364 9.45576 53.6175 10.6729 56.0525 11.0786L58.3749 11.4392C60.3138 11.7773 61.396 12.5662 61.396 14.2341C61.396 16.1951 59.7953 17.4573 57.3602 17.4573C54.8351 17.4573 53.2567 16.2402 53.1215 14.1666H51.408C51.5433 16.8713 53.6175 18.8548 57.3376 18.8548ZM31.7406 18.5392H25.4275V2.67131H31.5151C34.1982 2.67131 36.0695 4.24908 36.0695 6.77352C36.0695 8.59921 35.0323 9.81641 33.364 10.2221V10.2897C35.348 10.6729 36.5654 12.0253 36.5654 14.144C36.5654 16.8713 34.5589 18.5392 31.7406 18.5392ZM31.2896 9.63608C33.2062 9.63608 34.3785 8.59921 34.3785 6.97637V6.75097C34.3785 5.12812 33.2062 4.11383 31.2896 4.11383H27.1185V9.63608H31.2896ZM31.4925 17.0967C33.5895 17.0967 34.8746 15.9472 34.8746 14.189V13.9637C34.8746 12.138 33.5669 11.0335 31.47 11.0335H27.1185V17.0967H31.4925ZM50.2209 18.5392H48.4171L47.0644 14.2341H40.7513L39.3985 18.5392H37.6849L42.8933 2.67131H44.9449L50.2209 18.5392ZM43.998 4.40685H43.8627L41.2022 12.8141H46.636L43.998 4.40685ZM65.6272 18.5392V2.67131H75.8181V4.13637H67.3177V9.591H75.1419V11.0335H67.3177V17.0741H75.8181V18.5392H65.6272Z" fill="#F4F4EF" />
              </svg>
            </span>
          </div>
        </div>

        {/* Right Section - Split into two 50vh sections */}
        <div className="w-full lg:w-1/2 flex flex-col ">
          {/* Top Half */}
          <div className="h-[40vh] lg:h-[50vh] bg-[#B8CCE0] p-4 lg:p-8 flex items-center justify-center rounded-[56px]">
            <Button variant="primary"
              icon={<svg width="41" height="40" viewBox="0 0 41 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.2925 10.625L23.2375 18.095L30.7075 21.0425L23.2375 23.9875L20.2925 31.4575L17.345 23.9875L9.875 21.0425L17.345 18.095L20.2925 10.625Z" fill="#F4F4EF" />
                <path d="M20.2925 9.5825C20.7175 9.5825 21.105 9.845 21.26 10.2425L24.04 17.2925L31.09 20.0725C31.284 20.1496 31.4503 20.2832 31.5675 20.4559C31.6847 20.6286 31.7474 20.8325 31.7474 21.0413C31.7474 21.25 31.6847 21.4539 31.5675 21.6266C31.4503 21.7993 31.284 21.9329 31.09 22.01L24.04 24.79L21.26 31.84C21.1829 32.034 21.0493 32.2003 20.8766 32.3175C20.7039 32.4347 20.5 32.4974 20.2913 32.4974C20.0825 32.4974 19.8786 32.4347 19.7059 32.3175C19.5332 32.2003 19.3996 32.034 19.3225 31.84L16.5425 24.79L9.4925 22.01C9.29854 21.9329 9.13219 21.7993 9.01499 21.6266C8.89779 21.4539 8.83514 21.25 8.83514 21.0413C8.83514 20.8325 8.89779 20.6286 9.01499 20.4559C9.13219 20.2832 9.29854 20.1496 9.4925 20.0725L16.5425 17.2925L19.3225 10.2425C19.4001 10.0484 19.5339 9.88196 19.7067 9.76438C19.8795 9.6468 20.0835 9.58347 20.2925 9.5825ZM20.2925 13.465L18.315 18.475C18.2622 18.6077 18.1828 18.7283 18.0818 18.8293C17.9808 18.9303 17.8602 19.0097 17.7275 19.0625L12.715 21.0375L17.7275 23.0175C17.86 23.07 17.9804 23.149 18.0814 23.2496C18.1824 23.3501 18.2619 23.4702 18.315 23.6025L20.29 28.6175L22.27 23.6025C22.3228 23.4705 22.4019 23.3505 22.5025 23.25C22.603 23.1494 22.723 23.0703 22.855 23.0175L27.87 21.04L22.855 19.0625C22.7227 19.0094 22.6026 18.9299 22.5021 18.8289C22.4015 18.7279 22.3225 18.6075 22.27 18.475L20.2925 13.465ZM10.9175 7.5L12.2425 10.34L15.0825 11.665L12.2425 12.9925L10.9175 15.8325L9.5925 12.9925L6.75 11.6675L9.59 10.3425L10.9175 7.5Z" fill="#F4F4EF" />
              </svg>}
            >
              Early Access
            </Button>
          </div>

          {/* Bottom Half */}
          <div className="h-auto lg:h-[50vh] bg-[#192548] p-4 lg:p-8 flex items-center justify-center rounded-[56px]">
            <div className="flex flex-col gap-20 my-20">
              <SocialButton
                variant="primary"
                icon={<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19.9786 2.03265H23.6996L15.5702 11.324L25.1338 23.9674H17.6456L11.7806 16.2993L5.06967 23.9674H1.34638L10.0415 14.0293L0.867188 2.03265H8.54549L13.847 9.04166L19.9786 2.03265ZM18.6726 21.7402H20.7345L7.42512 4.14289H5.21252L18.6726 21.7402Z" fill="#F4F4EF" />
                </svg>}
                link="https://x.com/EarnKit_ai"
              >
                EarnKit_ai
              </SocialButton>
              <SocialButton
                variant="primary"
                icon={<svg width="26" height="24" viewBox="0 0 26 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" clipRule="evenodd" d="M8.85231 23.6425H0.606267V22.7412C0.606267 22.3263 0.942589 21.99 1.35743 21.99H1.50764V21.0887C1.50764 20.6738 1.84393 20.3375 2.25877 20.3375V6.96724H1.43254L0.456055 3.66222H4.81266V0.357239H21.1874V3.66222H25.5441L24.5676 6.96724H23.7413V20.3375C24.1562 20.3375 24.4925 20.6738 24.4925 21.0887V21.99H24.6427C25.0575 21.99 25.3938 22.3263 25.3938 22.7412V23.6425H17.1571V22.7412C17.1571 22.3263 17.4934 21.99 17.9082 21.99H18.0584V21.0887C18.0584 20.6824 18.3809 20.3515 18.7838 20.338V12.9764C18.5181 10.0285 16.0171 7.71837 13.0001 7.71837C9.98303 7.71837 7.48197 10.0285 7.2163 12.9764V20.3377C7.6235 20.3465 7.95093 20.6793 7.95093 21.0887V21.5393V21.99H8.10114C8.51599 21.99 8.85231 22.3263 8.85231 22.7412V23.6425Z" fill="#F4F4EF" />
                </svg>}
                link="https://warpcast.com/earnkit"
              >
                EarnKit
              </SocialButton>
            </div>
          </div>
        </div>
      </div>
      <section>
        <div className="w-full bg-[#8154D4] p-4 flex flex-col items-center justify-between rounded-[40px]">
          <div className="flex flex-col lg:flex-row items-center justify-center w-full p-6 lg:p-2 gap-x-8">
            <p className="w-[80%] lg:w-auto font-funnel-display text-center text-white text-[22px] lg:text-2xl mb-10 lg:mb-0">
              Check out our first AI agent built on top of EarnKit&apos;s framework
            </p>
            <SocialButton
              variant="secondary"
              icon={<svg width="24" height="20" viewBox="0 0 26 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M8.85231 23.6425H0.606267V22.7412C0.606267 22.3263 0.942589 21.99 1.35743 21.99H1.50764V21.0887C1.50764 20.6738 1.84393 20.3375 2.25877 20.3375V6.96724H1.43254L0.456055 3.66222H4.81266V0.357239H21.1874V3.66222H25.5441L24.5676 6.96724H23.7413V20.3375C24.1562 20.3375 24.4925 20.6738 24.4925 21.0887V21.99H24.6427C25.0575 21.99 25.3938 22.3263 25.3938 22.7412V23.6425H17.1571V22.7412C17.1571 22.3263 17.4934 21.99 17.9082 21.99H18.0584V21.0887C18.0584 20.6824 18.3809 20.3515 18.7838 20.338V12.9764C18.5181 10.0285 16.0171 7.71837 13.0001 7.71837C9.98303 7.71837 7.48197 10.0285 7.2163 12.9764V20.3377C7.6235 20.3465 7.95093 20.6793 7.95093 21.0887V21.5393V21.99H8.10114C8.51599 21.99 8.85231 22.3263 8.85231 22.7412V23.6425Z" fill="#F4F4EF" />
              </svg>}
              link="https://warpcast.com/coinvise"
            >
              @coinvise
            </SocialButton>
          </div>
        </div >

        {/* Founding Team Section */}
        <div className="w-full bg-[#B8CCE0] px-16 pb-32 pt-24 lg:pt-32 rounded-[56px]">
          <h2 className="text-[#192548] text-5xl font-medium font-funnel-display text-center mb-16 lg:mb-24">
            Founding Team
          </h2>

          <div className="flex flex-col lg:flex-row justify-center items-center lg:items-start">
            {/* Founder */}
            <div className="flex flex-col items-center mb-20 lg:mb-0">
              <div className="w-48 h-48 lg:w-64 lg:h-64 flex items-center justify-center mb-4 lg:mb-6 object-cover">
                <svg width="132" height="131" viewBox="0 0 132 131" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" clipRule="evenodd" d="M105.47 65.4484C105.47 43.6493 87.7985 25.9777 65.9994 25.9777C44.2004 25.9777 26.5287 43.6493 26.5287 65.4484H0.794922C0.794919 29.437 29.988 0.2439 65.9994 0.243896C102.011 0.243893 131.204 29.4369 131.204 65.4484H105.47ZM53.7338 130.217V104.483H28.0131V78.7491H53.7469V104.483H79.4676V130.217H53.7338ZM53.7338 53.0153V78.749H79.4676V53.0153H53.7338ZM79.6441 78.7491V104.483H105.378V78.7491H79.6441Z" fill="white" />
                </svg>
              </div>
              <h3 className="text-[#192548] text-2xl font-medium font-funnel-display underline mb-2"><Link href="https://x.com/0xjenil" target="_blank">Jenil</Link></h3>
              <p className="text-[#192548] font-normal  text-xl">Founder</p>
            </div>

            {/* CTO */}
            <div className="flex flex-col items-center mb-20 lg:mb-0">
              <div className="w-48 h-48 lg:w-64 lg:h-64 flex items-center justify-center mb-4 lg:mb-6 object-cover">
                <svg width="130" height="131" viewBox="0 0 130 131" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" clipRule="evenodd" d="M89.3702 5.5615C77.6194 0.694123 64.689 -0.579403 52.2144 1.90196C39.7397 4.38333 28.281 10.5081 19.2873 19.5019C10.2935 28.4956 4.16873 39.9543 1.68736 52.429C-0.794002 64.9036 0.479524 77.834 5.3469 89.5849C10.2143 101.336 18.4569 111.379 29.0324 118.446C39.6079 125.512 52.0413 129.284 64.7604 129.284V103.55C57.131 103.55 49.6729 101.288 43.3293 97.0488C36.9857 92.8102 32.0415 86.7856 29.1218 79.737C26.2022 72.6883 25.4383 64.9322 26.9267 57.4494C28.4151 49.9666 32.089 43.0932 37.4838 37.6984C42.8786 32.3036 49.752 28.6297 57.2348 27.1413C64.7176 25.6529 72.4737 26.4168 79.5224 29.3364C86.571 32.2561 92.5956 37.2003 96.8342 43.5439C101.073 49.8875 103.335 57.3456 103.335 64.975H129.069C129.069 52.2559 125.297 39.8225 118.231 29.247C111.165 18.6715 101.121 10.4289 89.3702 5.5615ZM78.3569 104.196V78.4625H104.091V104.196H78.3569ZM104.198 130.052V104.318H129.932V130.052H104.198Z" fill="white" />
                </svg>
              </div>
              <h3 className="text-[#192548] text-2xl font-medium font-funnel-display underline mb-2"><Link href="https://x.com/hridambasu" target="_blank">Hridam</Link></h3>
              <p className="text-[#192548] font-normal  text-xl">CTO</p>
            </div>

            {/* Design */}
            <div className="flex flex-col items-center mb-20 lg:mb-0">
              <div className="w-48 h-48 lg:w-64 lg:h-64 flex items-center justify-center mb-4 lg:mb-6">
                <svg width="130" height="131" viewBox="0 0 130 131" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" clipRule="evenodd" d="M64.7786 0.230225C56.3487 0.230225 48.0012 1.89063 40.213 5.11664C32.4247 8.34265 25.3481 13.0711 19.3872 19.032C13.4263 24.9929 8.69787 32.0695 5.47186 39.8577C2.24585 47.646 0.585448 55.9934 0.585449 64.4234L26.3192 64.4234C26.3192 59.3729 27.314 54.3717 29.2468 49.7056C31.1796 45.0395 34.0125 40.7998 37.5837 37.2285C41.155 33.6572 45.3948 30.8243 50.0609 28.8916C54.727 26.9588 59.7281 25.964 64.7786 25.964C69.8292 25.964 74.8303 26.9588 79.4964 28.8916C84.1625 30.8243 88.4022 33.6572 91.9735 37.2285C95.5448 40.7998 98.3777 45.0395 100.31 49.7056C102.243 54.3717 103.238 59.3728 103.238 64.4234H128.972C128.972 55.9934 127.311 47.646 124.085 39.8577C120.859 32.0695 116.131 24.9929 110.17 19.032C104.209 13.0711 97.1326 8.34265 89.3443 5.11664C81.556 1.89063 73.2086 0.230225 64.7786 0.230225ZM64.6512 101.131C69.3528 101.131 74.0085 100.205 78.3523 98.4059C82.6961 96.6067 86.643 93.9695 89.9675 90.6449C93.2921 87.3203 95.9294 83.3734 97.7286 79.0296C99.5279 74.6858 100.454 70.0302 100.454 65.3285H74.7201C74.7201 66.6508 74.4597 67.9601 73.9537 69.1817C73.4477 70.4033 72.706 71.5133 71.771 72.4483C70.836 73.3833 69.726 74.125 68.5044 74.631C67.2828 75.137 65.9734 75.3975 64.6512 75.3975C63.3289 75.3975 62.0195 75.137 60.7979 74.631C59.5763 74.125 58.4663 73.3833 57.5313 72.4483C56.5963 71.5133 55.8546 70.4033 55.3486 69.1817C54.8426 67.9601 54.5822 66.6508 54.5821 65.3285H28.8484C28.8484 70.0302 29.7744 74.6858 31.5737 79.0296C33.3729 83.3734 36.0102 87.3203 39.3348 90.6449C42.6594 93.9695 46.6062 96.6067 50.95 98.4059C55.2938 100.205 59.9495 101.131 64.6512 101.131Z" fill="white" />
                </svg>
              </div>
              <h3 className="text-[#192548] text-2xl font-medium font-funnel-display underline mb-2"><Link href="https://x.com/ashventure" target="_blank">Ashish</Link></h3>
              <p className="text-[#192548] font-normal text-xl">Design</p>
            </div>

            {/* Growth */}
            <div className="flex flex-col items-center mb-20 lg:mb-0">
              <div className="w-48 h-48 lg:w-64 lg:h-64 flex items-center justify-center mb-4 lg:mb-6 object-cover">
                <svg width="132" height="131" viewBox="0 0 132 131" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" clipRule="evenodd" d="M105.47 65.4484C105.47 43.6493 87.7985 25.9777 65.9994 25.9777C44.2004 25.9777 26.5287 43.6493 26.5287 65.4484H0.794922C0.794919 29.437 29.988 0.2439 65.9994 0.243896C102.011 0.243893 131.204 29.4369 131.204 65.4484H105.47ZM53.7338 130.217V104.483H28.0131V78.7491H53.7469V104.483H79.4676V130.217H53.7338ZM53.7338 53.0153V78.749H79.4676V53.0153H53.7338ZM79.6441 78.7491V104.483H105.378V78.7491H79.6441Z" fill="white" />
                </svg>
              </div>
              <h3 className="text-[#192548] text-2xl font-medium font-funnel-display underline mb-2"><Link href="https://x.com/sidselloe" target="_blank">Sidsel</Link></h3>
              <p className="text-[#192548] font-normal text-xl">Growth</p>
            </div>
          </div>
        </div>

        {/* Investors Section */}
        <div className="w-full bg-[#192548] px-12 lg:px-16 py-32 rounded-[56px] flex flex-col items-center justify-center  ">
          <h2 className="text-white text-5xl font-funnel-display text-center mb-24">
            Our Investors
          </h2>

          <div className="w-full lg:w-4/5 grid grid-cols-2 lg:grid-cols-5 gap-x-8 lg:gap-x-16 gap-y-20">
            {/* First Row */}
            <div className="flex items-center justify-center w-[100%] h-auto">
              <InvestorsIcons.LAO />
            </div>
            <div className="flex items-center justify-center w-[100%] h-auto">

              <InvestorsIcons.VoltCapital />
            </div>
            <div className="flex items-center justify-center w-[100%] h-auto">

              <InvestorsIcons.Galaxy />
            </div>
            <div className="flex items-center justify-center w-[100%] h-auto">
              <InvestorsIcons.Ideo />
            </div>
            <div className="flex items-center justify-center w-[100%] h-auto">
              <InvestorsIcons.Acapital />
            </div>

            {/* Second Row */}
            <div className="flex items-center justify-center w-[100%] h-auto">
              <InvestorsIcons.Scalar />
            </div>
            <div className="flex items-center justify-center w-[100%] h-auto">
              <InvestorsIcons.gcr />
            </div>
            <div className="flex items-center justify-center w-[100%] h-auto">
              <InvestorsIcons.defiAlliance />
            </div>
            <div className="flex items-center justify-center w-[100%] h-auto">
              <InvestorsIcons.block0 />
            </div>
            <div className="flex items-center justify-center w-[100%] h-auto">
              <InvestorsIcons.cooperTurnley />
            </div>
          </div>
        </div>
      </section >
    </>
  );
}
