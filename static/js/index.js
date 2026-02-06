// Slider has 7 discrete positions (0–6).
// Each <audio> has a data-steps attribute with 7 comma-separated filenames.
// The slider index picks which file to load.

document.addEventListener('DOMContentLoaded', function() {
    // Store base paths on each audio element before any slider changes
    var audios = document.querySelectorAll('audio[data-steps]');
    audios.forEach(function(audio) {
        var src = audio.querySelector('source').getAttribute('src');
        audio.dataset.basepath = src.substring(0, src.lastIndexOf('/') + 1);
    });

    var sliders = document.querySelectorAll('.alpha-slider');
    sliders.forEach(function(slider) {
        slider.addEventListener('input', handleSliderChange);
    });
});

function handleSliderChange(e) {
    var slider = e.target;
    var idx = parseInt(slider.value);

    var promptExample = slider.closest('.prompt-example');

    // Update alpha display from data-labels
    var labels = slider.dataset.labels.split(',');
    var display = promptExample.querySelector('.alpha-display');
    var val = parseFloat(labels[idx]);
    if (val === 0) {
        display.textContent = 'No steering';
    } else if (val < 0) {
        // display.innerHTML = '&alpha; = ' + labels[idx] + ' &middot; &alpha;\u208B';
        display.innerHTML = '&alpha; = ' + labels[idx] + ' &lambda;';
    } else {
        // display.innerHTML = '&alpha; = ' + labels[idx] + ' &middot; &alpha;\u208A';
        display.innerHTML = '&alpha; = ' + labels[idx] + ' &lambda;';
    }

    // Update all audio sources
    var audios = promptExample.querySelectorAll('audio[data-steps]');
    audios.forEach(function(audio) {
        var steps = audio.dataset.steps.split(',');
        var wasPlaying = !audio.paused;
        var source = audio.querySelector('source');
        source.setAttribute('src', audio.dataset.basepath + steps[idx]);
        audio.load();
        if (wasPlaying) {
            audio.play().catch(function() {});
        }
    });
}

// Copy BibTeX to clipboard
function copyBibTeX() {
    var bibtexElement = document.getElementById('bibtex-code');
    var button = document.querySelector('.copy-bibtex-btn');
    var copyText = button.querySelector('.copy-text');

    if (bibtexElement) {
        navigator.clipboard.writeText(bibtexElement.textContent).then(function() {
            button.classList.add('copied');
            copyText.textContent = 'Copied!';
            setTimeout(function() {
                button.classList.remove('copied');
                copyText.textContent = 'Copy';
            }, 2000);
        }).catch(function() {
            var textArea = document.createElement('textarea');
            textArea.value = bibtexElement.textContent;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);

            button.classList.add('copied');
            copyText.textContent = 'Copied!';
            setTimeout(function() {
                button.classList.remove('copied');
                copyText.textContent = 'Copy';
            }, 2000);
        });
    }
}

// Scroll to top functionality
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// Show/hide scroll to top button
window.addEventListener('scroll', function() {
    var scrollButton = document.querySelector('.scroll-to-top');
    if (window.pageYOffset > 300) {
        scrollButton.classList.add('visible');
    } else {
        scrollButton.classList.remove('visible');
    }
});
