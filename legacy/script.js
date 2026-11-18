// I have neither given nor received unauthorized assistance on this assignment.
// During the preparation of this assignment,
// Amy Sarr used Copilot in lines 76-79 and 97-103 to display album rankings and album array positions.
// Copilot was also used for debugging and error catching in getAlbum.
const albums = []; // array for searched album titles
const albumData = []; // array where selected albums will be added for later comparison

// async function that fetches album covers, artist names, and titles after using iTunes search API
async function getAlbum(title) {
    const searchResults = document.getElementById("results");
    // fetches iTunes API data
    try {
        const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=album`);
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            // Clears results from last search and displays new matching ones
            searchResults.innerHTML = `<h2>Please select the correct match for "${title}"</h2>`;

            // Display all matching results as buttons
            data.results.forEach((album, index) => {
                const albumOption = document.createElement("button");
                albumOption.innerText = `${album.collectionName} by ${album.artistName}`;
                albumOption.onclick = () => {
                    // Handle the user’s selection
                    addAlbumPick(
                        {
                            title: album.collectionName,
                            artist: album.artistName,
                            coverURL: album.artworkUrl100
                        });
                    searchResults.innerHTML = ""; // Clear results after selection
                };
                searchResults.appendChild(albumOption);
            });
        }
        else {
            alert(`Sorry, there are no matches for "${title}". Please enter another album.`);
        }
    }
    catch (error) {
        console.error("Error fetching album data:", error);
        searchResults.innerHTML = `<p>Error fetching album data. Please try again.</p>`;
    }
}

// used for Add Album button, finds relevant album titles after clicked
function addAlbum() {
    const title = document.getElementById("albumTitle").value;

    if (title) {
        getAlbum(title); // Fetch data for the entered album title
        document.getElementById("albumForm").reset();
    } else {
        alert("Please enter an album title!");
    }
}
// adds user's album pick to an array
// when array reaches 10 items starts ranking process
function addAlbumPick(album) {
    albumData.push(album);

    if (albumData.length === 10) {
        alert("You have entered 10 albums! Please start ranking them.");

        sort();
    }
}

// compares albums in array to each other
// "1" = the album being compared to the rest of the array
// if one album is chosen over the other, then array spots are swapped
function sort() {
    let sortedAlbums = [...albumData]; // Copy albumData for sorting

    for (let i = 0; i < sortedAlbums.length; i++) {
        for (let j = i + 1; j < sortedAlbums.length; j++) {
            const albumA = sortedAlbums[i];
            const albumB = sortedAlbums[j];

            let userChoice = prompt(`Which album do you prefer? Please enter the corresponding number. \n1: ${albumA.title} by ${albumA.artist} \n2: ${albumB.title} by ${albumB.artist}`);

            if (userChoice === "2") {
                [sortedAlbums[i], sortedAlbums[j]] = [sortedAlbums[j], sortedAlbums[i]];
            }
        }
    }
    displayRankings(sortedAlbums);
}

// after all comparisons are done, displays final array as a table ranked in order
function displayRankings(sortedAlbums) {
    alert('Sorting complete! Here is your final album ranking.');
    const tableBody = document.getElementById("albumsTable").getElementsByTagName("tbody")[0];
    tableBody.innerHTML = ""; // Clear previous table data

    sortedAlbums.forEach((album, index) => {
        const row = tableBody.insertRow();
        row.innerHTML = `
            <td>${index + 1}</td>
            <td><img src="${album.coverURL}" alt="${album.title}"></td>
            <td>${album.title}</td>
            <td>${album.artist}</td>
        `;
    });
}

// for New Sorting button
// refreshes the page and clears previous data
function refresh() {
    location.reload();
}

