document.addEventListener("DOMContentLoaded", function () {
    let modal = document.getElementById("videoModal");
    let modalVideo = document.getElementById("modalVideo");
    let modalVideoSource = document.getElementById("modalVideoSource");
    let closeButton = document.querySelector(".close-video");
    let fullscreenButton = document.querySelector(".fullscreen-video");

    // Find all preview videos
    document.querySelectorAll(".preview-video").forEach(preview => {
        preview.addEventListener("click", function () {
            let videoPath = this.getAttribute("data-main"); // Get the main video path
            if (!videoPath) {
                console.error("No video path found!");
                return;
            }

            modalVideoSource.src = videoPath;
            modalVideo.load();
            modal.style.display = "flex";
            document.body.style.overflow = "hidden"; // Disable background scrolling
            modalVideo.play();
        });
    });

    // Close modal when clicking "X"
    closeButton.addEventListener("click", closeModal);

    // Close modal when clicking outside the video area
    modal.addEventListener("click", function (event) {
        if (event.target === modal) {
            closeModal();
        }
    });

    function closeModal() {
        modal.style.display = "none";
        document.body.style.overflow = "";
        modalVideo.pause();
        modalVideo.currentTime = 0; // Reset video time
    }

    // Fullscreen button functionality
    fullscreenButton.addEventListener("click", function () {
        if (modalVideo.requestFullscreen) {
            modalVideo.requestFullscreen();
        } else if (modalVideo.webkitRequestFullscreen) { // Safari
            modalVideo.webkitRequestFullscreen();
        } else if (modalVideo.msRequestFullscreen) { // IE11
            modalVideo.msRequestFullscreen();
        }
    });
});