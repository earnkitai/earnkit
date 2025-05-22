"use client";

import BackgroundVideoLandingPage from "./BackgroundVideoLandingPage";

export default function DesktopOnlyMessage() {
    return (
        <div className="md:hidden h-[100dvh] w-full flex flex-col items-center justify-center p-6 text-center">
            <div className="my-10">
                <svg width="181" height="32" viewBox="0 0 181 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15.5918 16.4082C15.5915 25.0192 8.61111 32 0 32V24.2441C4.3275 24.2441 7.83562 20.7356 7.83594 16.4082H15.5918ZM23.3623 16.4082C23.3627 20.699 26.841 24.1777 31.1318 24.1777V31.9336C22.5574 31.9336 15.6059 24.9826 15.6055 16.4082H23.3623ZM174.141 9.74902H180.007V16.1562H174.141V20.5029C174.155 23.2849 176.305 25.425 180.02 25.4375L179.998 31.8447C173.703 31.8236 167.762 27.7015 167.732 20.5234V3.90723H174.141V9.74902ZM71.5225 8.13379H65.2451C61.672 8.15246 58.6172 10.3613 57.3545 13.4863H68.418V19.8936H57.3545C58.6212 23.0281 61.691 25.241 65.2783 25.2461H71.5225V31.6543H65.0908V31.6523C56.9184 31.5455 50.3262 24.8872 50.3262 16.6895C50.3264 8.49191 56.9186 1.83441 65.0908 1.72754V1.72559H71.5225V8.13379ZM95.0762 31.5713H88.668V30.5225C87.2606 31.1734 85.6925 31.5361 84.04 31.5361C77.9456 31.5359 73.0049 26.5955 73.0049 20.501C73.005 14.4066 77.9457 9.46605 84.04 9.46582C85.6926 9.46582 87.2606 9.82946 88.668 10.4805V9.30957H95.0762V31.5713ZM165.297 31.5713H158.89V9.30957H165.297V31.5713ZM155.932 3.60547C155.897 8.57532 154.007 14.4765 149.591 18.8418L157.543 31.5303H149.98L141.109 17.375L143.522 15.6152C147.64 12.612 149.496 7.69465 149.524 3.56152L155.932 3.60547ZM121.615 9.46582C127.71 9.46595 132.65 14.4065 132.65 20.501V31.5264H126.242V20.501C126.242 17.9454 124.171 15.8742 121.615 15.874C119.06 15.874 116.987 17.9453 116.987 20.501V31.5264H110.58V20.501C110.58 14.4065 115.521 9.46582 121.615 9.46582ZM109.396 15.873L108.058 15.8896H108.039C105.458 15.8896 103.38 17.9703 103.38 20.501V31.5195H96.9717V20.501C96.9718 14.3883 101.958 9.49248 108.019 9.48145L109.319 9.46582L109.396 15.873ZM141.028 31.4492H134.62V3.45703H141.028V31.4492ZM84.04 15.874C81.4845 15.8742 79.4132 17.9455 79.4131 20.501C79.4131 23.0566 81.4845 25.1287 84.04 25.1289C86.5958 25.1289 88.668 23.0568 88.668 20.501C88.6678 17.9453 86.5957 15.874 84.04 15.874ZM15.5996 0.865234C24.1828 0.865503 31.1414 7.82403 31.1416 16.4072H23.3848C23.3845 12.1076 19.8992 8.62136 15.5996 8.62109C11.2998 8.62109 7.81372 12.1075 7.81348 16.4072H0.0576172C0.0578621 7.82386 7.01619 0.865234 15.5996 0.865234ZM162.094 1.02051C163.863 1.02067 165.297 2.45527 165.297 4.22461C165.297 5.99378 163.863 7.42757 162.094 7.42773C160.324 7.42773 158.89 5.99388 158.89 4.22461C158.89 2.45517 160.324 1.02051 162.094 1.02051Z" fill="#E5EEFC" />
                </svg>
            </div>
            <BackgroundVideoLandingPage />

            <h1 className="text-white font-funnel-display text-3xl font-semibold mb-4">
                Desktop Experience Required
            </h1>
            <p className="text-color7 font-funnel-sans text-lg mb-6 max-w-md">
                For the best experience, please view this website on a desktop device. Our interactive features and animations are optimized for larger screens.
            </p>
            <div className="flex items-center gap-2 text-color7">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 4H4C2.89543 4 2 4.89543 2 6V18C2 19.1046 2.89543 20 4 20H20C21.1046 20 22 19.1046 22 18V6C22 4.89543 21.1046 4 20 4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M8 2V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M16 2V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 10H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="font-funnel-sans">Switch to desktop view</span>
            </div>
        </div>
    );
} 