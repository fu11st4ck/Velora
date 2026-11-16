import 'package:material_ui/material_ui.dart';

/// The diamond "V" monogram from the reference identity.
class VeloraMark extends StatelessWidget {
  const VeloraMark({super.key, this.size = 64});
  final double size;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      label: 'Velora',
      image: true,
      child: SizedBox.square(
        dimension: size,
        child: Center(
          child: Transform.rotate(
            angle: 0.785398, // 45°
            child: Container(
              width: size * 0.7,
              height: size * 0.7,
              decoration: BoxDecoration(
                border: Border.all(color: scheme.secondary, width: 1.5),
              ),
              alignment: Alignment.center,
              child: Transform.rotate(
                angle: -0.785398,
                child: ExcludeSemantics(
                  child: Text(
                    'V',
                    style: TextStyle(
                      fontFamily: 'PlayfairDisplay',
                      fontSize: size * 0.4,
                      height: 1,
                      color: scheme.secondary,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
