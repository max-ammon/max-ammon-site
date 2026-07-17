document.addEventListener("DOMContentLoaded", function () {
    const modal = document.getElementById("imageModal");
    const canvas = document.getElementById("colorManagedCanvas");
    const ctx = canvas.getContext("2d", { colorSpace: "display-p3" }); // Wider color gamut
    const closeButton = document.querySelector(".close");
    const prevButton = document.querySelector(".prev");
    const nextButton = document.querySelector(".next");

    let currentIndex = 0;
    let images = [];

    // Select all image containers
    document.querySelectorAll(".image-container").forEach(container => {
        const thumbnails = container.querySelectorAll(".thumbnail");

        let imageSet = [];
        thumbnails.forEach((thumb, index) => {
            imageSet.push(thumb.getAttribute("data-full"));

            // Open modal when clicking a thumbnail
            thumb.addEventListener("click", function () {
                images = imageSet;
                currentIndex = index;
                openImage(images[currentIndex]);
            });
        });
    });

    function openImage(imageSrc) {
        const img = new Image();
        img.src = imageSrc;
        img.crossOrigin = "anonymous"; // Ensure the image loads properly

        img.onload = function () {
            const maxWidth = window.innerWidth * 0.9;
            const maxHeight = window.innerHeight * 0.9;

            // Get original aspect ratio
            const imgAspectRatio = img.width / img.height;
            const modalAspectRatio = maxWidth / maxHeight;

            let displayWidth, displayHeight;

            if (imgAspectRatio > modalAspectRatio) {
                displayWidth = maxWidth;
                displayHeight = maxWidth / imgAspectRatio;
            } else {
                displayHeight = maxHeight;
                displayWidth = maxHeight * imgAspectRatio;
            }

            // Set canvas size
            canvas.width = displayWidth;
            canvas.height = displayHeight;

            // Clear previous image
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw the image onto the canvas
            ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

            // Force color space conversion to wider gamut
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            ctx.putImageData(imgData, 0, 0);

            // Show modal
            modal.style.display = "flex";
            document.body.style.overflow = "hidden"; // Disable scrolling
        };
    }

    // Navigation buttons
    prevButton.addEventListener("click", function () {
        if (currentIndex > 0) {
            currentIndex--;
            openImage(images[currentIndex]);
        }
    });

    nextButton.addEventListener("click", function () {
        if (currentIndex < images.length - 1) {
            currentIndex++;
            openImage(images[currentIndex]);
        }
    });

    // Close modal
    closeButton.addEventListener("click", function () {
        modal.style.display = "none";
        document.body.style.overflow = ""; // Enable scrolling again
    });

    modal.addEventListener("click", function (event) {
        if (event.target === modal) {
            modal.style.display = "none";
            document.body.style.overflow = "";
        }
    });
});