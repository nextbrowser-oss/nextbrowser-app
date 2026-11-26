#include <Carbon/Carbon.h>
#include <stdio.h>

/* TIS reports the input method as well as ordinary keyboard layouts. */
int main(void) {
    TISInputSourceRef source = TISCopyCurrentKeyboardInputSource();
    if (!source) return 1;
    CFArrayRef languages = TISGetInputSourceProperty(source, kTISPropertyInputSourceLanguages);
    if (languages && CFArrayGetCount(languages) > 0) {
        char tag[128];
        CFStringRef language = CFArrayGetValueAtIndex(languages, 0);
        if (CFStringGetCString(language, tag, sizeof(tag), kCFStringEncodingUTF8)) puts(tag);
    }
    CFRelease(source);
    return 0;
}
